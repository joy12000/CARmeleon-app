package ai.pleos.carmeleon.agent

import ai.pleos.carmeleon.core.*
import ai.pleos.carmeleon.core.GuidanceStatus as ObservedGuidanceStatus
import ai.pleos.carmeleon.ui.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

/** Connects one foreground vehicle session to the account service. SDK and desired plan remain separate owners. */
class AgentRuntime(
    parentScope: CoroutineScope,
    private val journey: JourneyController,
    private val navigation: NavigationGateway,
    private val voice: VoiceGateway,
    private val api: AgentHttpClient?,
    private val cache: AgentLocalStore = MemoryAgentLocalStore(),
    private val routeEvidence: RouteEvidenceProvider = UnsupportedRouteEvidenceProvider(),
) {
    private val job = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + job)
    private val mutable = MutableStateFlow(AgentUiState(notice = if (api == null) "AI 서버 주소를 설정해 주세요." else "로그인하면 경로와 기억을 이어갑니다."))
    val state: StateFlow<AgentUiState> = mutable.asStateFlow()
    var session = AgentSession(UUID.randomUUID().toString())
        private set
    private var path: JsonObject? = null
    private var account: JsonObject? = null
    private var notes = emptyList<JsonObject>()
    private var materials = emptyList<JsonObject>()
    private val proposals = linkedMapOf<String, JsonObject>()
    private var turnJob: Job? = null
    private var currentTurn: String? = null
    private data class PlaybackOwner(val id: String, val chunk: SpeechChunk, var interrupted: Boolean = false)
    private var activePlayback: PlaybackOwner? = null
    private val playbackOwners = mutableMapOf<String, PlaybackOwner>()
    private var turnStreamCompleted = false
    private var resumeDecisionId: String? = null
    private val navigationActions = mutableMapOf<String, String>()
    private var foreground = true
    private var conversationActive = false
    private var lastHumanActivityAt = 0L
    private var editingAllowed: Boolean? = null
    private val narrativeTurns = mutableMapOf<String, String>()
    private var proactive: ProactiveRuntime? = null
    private var quiet = false
    private var lastSequence = -1L
    private val stopGenerations = mutableMapOf<String, Long>()
    private var speechStreamFinal = false
    private var identityGeneration = 0L
    private val mutations = Mutex()
    val diagnostics = AgentDiagnostics()

    init {
        if (api != null) proactive = ProactiveRuntime(scope, api, routeEvidence,
            context = ::proactiveContext, guidanceFingerprint = { navigation.observed.value.fingerprint },
            speak = { utterance ->
                val safe = journey.state.value.vehicle.canSpeak && foreground && conversationActive && !quiet && currentTurn == null
                if (safe) scope.launch {
                    val id = session.beginTurn("${utterance.point.name} 경로 설명")
                    narrativeTurns[id] = utterance.id; currentTurn = id; speechStreamFinal = true; turnStreamCompleted = true
                    session.acceptSpeechChunk(id, utterance.text, true)
                    mutable.update { it.copy(subtitle = utterance.text, phase = AgentUiPhase.SPEAKING) }
                    drainSpeech(true)
                }
                safe
            })
        journey.transcriptHandler = { text -> diagnostics.record("stt.final"); submit(text) }
        scope.launch {
            journey.state.collect { value ->
                val preview = value.vehicle.origin == DataOrigin.PREVIEW
                mutable.update { it.copy(editable = preview || editingAllowed == true) }
                if (!value.vehicle.copy(audioFocusAllowed = true).canSpeak && value.speech.speaking) interrupt(yielded = true)
                val requestId = value.pendingRequestId
                if (requestId != null) return@collect
                navigationActions.toMap().forEach { (id, action) ->
                    if (value.phase in setOf(JourneyPhase.DRIVING, JourneyPhase.CONFIRMED, JourneyPhase.FAILED)) {
                        navigationActions.remove(id)
                        val observed = navigation.observed.value
                        reportAction(action, when {
                            !observed.refreshing && observed.status == ObservedGuidanceStatus.GUIDING && observed.origin == DataOrigin.PLEOS && value.phase != JourneyPhase.FAILED -> "GUIDING"
                            value.phase == JourneyPhase.FAILED -> "FAILED"
                            else -> "UNKNOWN"
                        }, value.error)
                    }
                }
            }
        }
        scope.launch { voice.state.collect { speech ->
            mutable.update { it.copy(phase = when {
                speech.speaking -> AgentUiPhase.SPEAKING
                speech.listening && currentTurn == null -> AgentUiPhase.LISTENING
                else -> it.phase
            }) }
        } }
        (voice as? StreamingVoiceGateway)?.let { gateway -> scope.launch { gateway.voiceEvents.collect { event ->
            diagnostics.record("voice.${event::class.simpleName}")
            when (event) {
                is VoiceEvent.Partial -> { lastHumanActivityAt = System.currentTimeMillis(); mutable.update { it.copy(subtitle = event.text) } }
                is VoiceEvent.SpeechDetected -> interrupt()
                is VoiceEvent.PlaybackStarted -> playbackOwners[event.turnId]?.let { owner ->
                    diagnostics.record("tts.onStart", owner.chunk.turnId)
                    if (!narrativeTurns.containsKey(owner.chunk.turnId)) reportPlayback(owner.chunk.turnId, "STARTED", owner.chunk.sourceChunkId)
                }
                is VoiceEvent.PlaybackDone -> {
                    val owner = playbackOwners.remove(event.turnId) ?: return@collect
                    if (activePlayback?.id == owner.id) activePlayback = null
                    if (!owner.interrupted && currentTurn == owner.chunk.turnId && session.acknowledgeChunk(owner.chunk.generation, owner.chunk.sequence)) {
                        if (!narrativeTurns.containsKey(owner.chunk.turnId)) reportPlayback(owner.chunk.turnId, "COMPLETED", owner.chunk.sourceChunkId)
                        drainSpeech(speechStreamFinal)
                        finishSpokenTurn()
                    }
                }
                is VoiceEvent.PlaybackInterrupted -> playbackOwners[event.turnId]?.let { owner ->
                    owner.interrupted = true
                    if (!narrativeTurns.containsKey(owner.chunk.turnId)) reportPlayback(owner.chunk.turnId, "UNKNOWN", owner.chunk.sourceChunkId)
                    if (currentTurn == owner.chunk.turnId && activePlayback?.id == owner.id) interrupt(yielded = true)
                }
                is VoiceEvent.PlaybackStopped -> {
                    val owner = playbackOwners.remove(event.turnId)
                    stopGenerations.remove(event.turnId)?.let { session.acknowledgeStop(it) }
                    if (activePlayback?.id == event.turnId) activePlayback = null
                    owner?.let { if (!narrativeTurns.containsKey(it.chunk.turnId)) reportPlayback(it.chunk.turnId, "STOPPED", it.chunk.sourceChunkId) }
                    drainSpeech(speechStreamFinal)
                }
                is VoiceEvent.Unavailable -> {
                    currentTurn?.let { reportPlayback(it, "FAILED") }
                    interrupt(true)
                    mutable.update { it.copy(phase = AgentUiPhase.HELD, notice = event.reason) }
                }
            }
        } } }
        scope.launch {
            var lastObservation: String? = null
            navigation.observed.collect { observed ->
                val observationKey = "${observed.fingerprint}:${observed.observationVersion}:${observed.refreshing}:${observed.observedAtMillis}"
                if (lastObservation == observationKey) return@collect
                lastObservation = observationKey
                diagnostics.record("navigation.observed", status = observed.status.name)
                if (account == null || path == null) return@collect
                if (!observed.refreshing && observed.status in setOf(ObservedGuidanceStatus.GUIDING, ObservedGuidanceStatus.SIMULATION, ObservedGuidanceStatus.IDLE)) {
                    val stale = proposals.filterValues { it.text("guidanceFingerprint")?.let { old -> old != observed.fingerprint } == true }.keys.toList()
                    stale.forEach { proposals.remove(it) }; publishChoices()
                }
                runCatching { api?.request("PUT", "/paths/${path!!.text("id")}/guidance", guidanceJson(observed)) }
            }
        }

        if (api?.hasToken() == true) work {
            cache.read("session")?.let { cached ->
                account = cached["account"]?.jsonObject; path = cached["path"]?.jsonObject
                path?.let { journey.applyAgentRoute(toJourney(it)) }
                account?.text("id")?.let { id -> cache.read("account-$id")?.let { data ->
                    notes = data.objects("notes"); materials = data.objects("materials")
                    mutable.update { it.copy(memories = notes.map { n -> AgentMemoryUi(n.text("id")!!, n.text("text").orEmpty()) }, materials = materials.map { m -> AgentMaterialUi(m.text("id")!!, m.text("name") ?: m.text("filename") ?: "자료", "저장된 자료") }) }
                } }
                mutable.update { it.copy(accountEmail = account?.text("email"), notice = "저장된 계획입니다. 서버 연결을 확인합니다.") }
            }
            restore()
        }
    }

    fun authenticate(email: String, password: String, register: Boolean) = work {
        val server = requireApi()
        val response = server.request("POST", if (register) "/auth/register" else "/auth/login", buildJsonObject {
            put("email", email.trim()); put("password", password); put("deviceName", "CARmeleon Kotlin")
        })
        interrupt(); identityGeneration++
        clearAccount()
        server.saveToken(response.text("accessToken") ?: error("계정 토큰이 없습니다."))
        restore()
    }
    fun logout() = work {
        interrupt(); identityGeneration++
        try { requireApi().request("POST", "/auth/logout") } finally { api?.saveToken(null); clearAccount() }
    }
    private fun clearAccount() {
        resumeDecisionId = null
        account = null; path = null; notes = emptyList(); materials = emptyList(); proposals.clear(); navigationActions.clear()
        cache.write("session", null)
        journey.clearPlannedRoute()
        mutable.value = AgentUiState(editable = mutable.value.editable, notice = "계정 연결을 종료했습니다.")
    }
    private suspend fun restore() {
        val server = requireApi()
        account = server.request("GET", "/auth/me")["account"]?.jsonObject ?: error("계정 정보를 확인하지 못했습니다.")
        mutable.update { it.copy(connected = true, accountEmail = account?.text("email"), notice = null) }
        val paths = server.request("GET", "/paths").objects("paths")
        path = paths.firstOrNull() ?: server.request("POST", "/paths", routeJson(journey.state.value.route.takeIf { it.stops.isNotEmpty() } ?: sampleRoute()))
        journey.applyAgentRoute(toJourney(path!!))
        refresh()
        val actions = server.request("GET", "/actions?pathId=${path!!.text("id")}").objects("actions")
        if (actions.any { it.text("status") in setOf("REQUESTED", "DISPATCHED", "UNKNOWN") }) {
            mutable.update { it.copy(notice = "아직 실제 안내 반영이 확인되지 않은 작업이 있습니다. 내비 상태를 확인해 주세요.") }
        }
        // Reconnection only restores decisions. It never redispatches a previous vehicle write or replays speech.
    }
    private suspend fun synchronizeDesiredPath() {
        val previous = requirePath()
        val id = previous.text("id")!!
        if (cache.read(draftKey(id)) != null) error("오프라인 초안을 먼저 동기화해 주세요. 초안은 보존되어 있습니다.")
        val latest = requireApi().request("GET", "/paths/$id")
        if (latest.number("revision") != previous.number("revision")) {
            navigationActions.values.toList().forEach { reportAction(it, "UNKNOWN", "다른 기기에서 계획이 변경되어 적용 상태를 다시 확인해야 합니다.") }
            navigationActions.clear(); proposals.clear(); publishChoices()
            path = latest
            journey.applyAgentRoute(toJourney(latest))
            cacheSession()
        }
    }
    private suspend fun refresh() {
        var current = requirePath()
        val id = current.text("id")!!
        if (cache.read(draftKey(id)) == null) {
            val latest = requireApi().request("GET", "/paths/$id")
            if (latest.number("revision") != current.number("revision")) { path = latest; current = latest; journey.applyAgentRoute(toJourney(latest)) }
        }
        val paths = requireApi().request("GET", "/paths").objects("paths")
        mutable.update {
            it.copy(
                paths = paths.map { p ->
                    AgentPathUi(
                        id = p.text("id")!!,
                        title = p.text("title").orEmpty(),
                        stopSummary = p.objects("stops").joinToString(" · ") { s -> s.text("name").orEmpty() },
                    )
                },
                activePathId = id,
            )
        }
        notes = requireApi().request("GET", "/memory?pathId=$id").objects("notes")
        materials = requireApi().request("GET", "/materials?pathId=$id").objects("materials")
        proposals.clear()
        requireApi().request("GET", "/paths/$id/proposals").objects("proposals").filter { it.text("status") == "PENDING" && (it.text("turnId") == null || it["approvalReady"]?.jsonPrimitive?.booleanOrNull == true) }.forEach { proposals[it.text("id")!!] = it }
        mutable.update { it.copy(memories = notes.map { note -> AgentMemoryUi(note.text("id")!!, note.text("text").orEmpty()) },
            materials = materials.map { item -> AgentMaterialUi(item.text("id")!!, item.text("name") ?: item.text("filename") ?: "자료", item.text("state") ?: "저장됨") }) }
        publishChoices()
        cacheSession()
        proactive?.refresh()
    }
    private fun cacheSession() {
        val owner = account ?: return
        cache.write("session", buildJsonObject { put("account", owner); path?.let { put("path", it) } })
        val id = owner.text("id") ?: return
        cache.write("account-$id", buildJsonObject { path?.let { put("path", it) }; putJsonArray("notes") { notes.forEach { add(it) } }; putJsonArray("materials") { materials.forEach { add(it) } } })
    }
    private fun publishChoices() {
        mutable.update { it.copy(choices = proposals.values.map { p -> AgentChoiceUi(p.text("id")!!, p.text("reason") ?: "경로를 변경할까요?",
            p.objects("stops").joinToString(" → ") { it.text("name").orEmpty() }) }) }
    }

    fun submit(raw: String) {
        val text = raw.trim(); if (text.isEmpty() || !foreground) return
        if (listOf("조용히 가자", "조용히 가", "말하지 마", "그만 말해").any { it in text }) {
            quiet = true; interrupt(); voice.stop(); mutable.update { it.copy(phase = AgentUiPhase.HELD, notice = "조용히 함께 갈게요.") }; return
        }
        quiet = false; conversationActive = true; lastHumanActivityAt = System.currentTimeMillis()
        // Voice approval refers to exactly one visible current decision; ambiguous approvals remain a question.
        if (proposals.size == 1 && text in setOf("응", "좋아", "승인", "적용해", "변경해", "응 바꿔", "취소", "아니", "안 바꿔")) {
            decide(proposals.keys.first(), text !in setOf("취소", "아니", "안 바꿔"), "VOICE"); return
        }
        interrupt()
        val server = api
        if (server == null || account == null || path == null) { fail("먼저 AI 서버에 로그인해 주세요."); return }
        val id = session.beginTurn(text); currentTurn = id; lastSequence = -1; speechStreamFinal = false; turnStreamCompleted = false
        diagnostics.record("turn.requested", id)
        mutable.update { it.copy(phase = AgentUiPhase.THINKING, subtitle = "", notice = null) }
        val identity = identityGeneration
        val resumedDecision = resumeDecisionId; resumeDecisionId = null
        turnJob = scope.launch {
            try {
                synchronizeDesiredPath()
                val p = requirePath()
                server.request("PUT", "/paths/${p.text("id")}/guidance", guidanceJson(navigation.observed.value))
                server.turn(buildJsonObject {
                    put("turnId", id); put("sessionId", conversationSessionId(p.text("id")!!)); put("pathId", p.text("id")); put("text", text)
                    put("guidanceFingerprint", navigation.observed.value.fingerprint)
                    resumedDecision?.let { put("resumeDecisionId", it) }
                    proactive?.lastReferencedPoint?.let { point -> put("referencedPointId", point.id) }
                    journey.state.value.location?.let { fix -> putJsonObject("location") { put("latitude", fix.coordinate.latitude); put("longitude", fix.coordinate.longitude) } }
                }).collect { event ->
                    if (currentTurn != id || identity != identityGeneration || event.data.text("turnId") != id) return@collect
                    val sequence = event.data.number("sequence")
                    if (sequence <= lastSequence) return@collect
                    lastSequence = sequence
                    diagnostics.record(event.name, id)
                    when (event.name) {
                        "assistant.speech_chunk" -> {
                            val final = event.data["isFinal"]?.jsonPrimitive?.booleanOrNull == true
                            speechStreamFinal = final
                            session.acceptSpeechChunk(id, event.data.text("text").orEmpty(), final, event.data.text("chunkId"))
                            mutable.update { it.copy(subtitle = session.state.value.response) }
                            drainSpeech(final)
                        }
                        "decision.required" -> {
                            event.data["proposal"]?.jsonObject?.let { proposal -> proposals[proposal.text("id")!!] = proposal; session.requireDecision(id, proposal.text("id")!!); publishChoices() }
                            mutable.update { it.copy(phase = AgentUiPhase.WAITING) }
                        }
                        "turn.completed" -> {
                            turnStreamCompleted = true
                            if (session.state.value.queuedChunks > 0) drainSpeech(speechStreamFinal)
                            finishSpokenTurn()
                            mutable.update { it.copy(phase = if (it.choices.isNotEmpty()) AgentUiPhase.WAITING else if (voice.state.value.speaking) AgentUiPhase.SPEAKING else AgentUiPhase.IDLE) }
                        }
                        "turn.error" -> error(event.data.text("message") ?: "AI 응답을 받지 못했습니다.")
                        "turn.cancelled" -> interrupt()
                    }
                }
                if (identity == identityGeneration) refresh()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (currentTurn == id && identity == identityGeneration) { interrupt(true); fail(e.message ?: "대화 연결이 끊겼습니다.") } }
        }
    }
    /** One complete sentence at a time. First sentence never waits for another token or empty final speak. */
    private suspend fun drainSpeech(final: Boolean) {
        if (activePlayback != null || session.state.value.awaitingStop) return
        val vehicle = journey.state.value.vehicle
        if (!foreground || quiet || !vehicle.copy(audioFocusAllowed = true).canSpeak) {
            session.discardQueuedChunks()
            mutable.update { it.copy(phase = AgentUiPhase.HELD, notice = vehicle.speechHoldReason ?: "음성 안내를 보류합니다.") }
            finishSpokenTurn()
            return
        }
        val output = voice as? StreamingVoiceGateway ?: run {
            session.discardQueuedChunks(); return
        }
        // Acquire focus before recording a chunk as submitted. A denied focus grant is not a playback success.
        if (!output.prepare()) { session.discardQueuedChunks(); return }
        if (!foreground || quiet || !journey.state.value.vehicle.copy(audioFocusAllowed = true).canSpeak) { session.discardQueuedChunks(); return }
        while (true) {
            val chunk = session.nextChunk() ?: break
            if (chunk.text.isBlank()) { session.acknowledgeChunk(chunk.generation, chunk.sequence); continue }
            val owner = PlaybackOwner("${chunk.turnId}-speech-${chunk.sequence}", chunk)
            activePlayback = owner; playbackOwners[owner.id] = owner
            output.speakChunk(owner.id, chunk.text, true)
            return
        }
        if (final) finishSpokenTurn()
    }

    private fun finishSpokenTurn() {
        val id = currentTurn ?: return
        if (!speechStreamFinal || activePlayback != null || session.state.value.queuedChunks > 0 || session.state.value.awaitingStop) return
        narrativeTurns.remove(id)?.let { proactive?.completed(it) }
        if (turnStreamCompleted || turnJob == null) {
            currentTurn = null
            mutable.update { it.copy(phase = if (proposals.isEmpty()) AgentUiPhase.IDLE else AgentUiPhase.WAITING) }
        }
    }

    fun interrupt(yielded: Boolean = false) {
        val old = currentTurn
        diagnostics.record("turn.local_interrupt", old)
        val stopped = if (yielded) session.yieldAudio() else session.interrupt()
        val owner = activePlayback
        if (owner != null) {
            owner.interrupted = true
            if (stopped.stopRequired) stopGenerations[owner.id] = stopped.generation
        }
        activePlayback = null
        (voice as? StreamingVoiceGateway)?.interruptSpeech() ?: voice.stop()
        currentTurn = null; turnJob?.cancel(); turnJob = null
        mutable.update { it.copy(phase = if (yielded) AgentUiPhase.HELD else AgentUiPhase.LISTENING) }
        val narrative = old?.let { narrativeTurns.remove(it) }
        if (narrative != null) proactive?.interrupted(narrative)
        else if (old != null && api != null && account != null) scope.launch { runCatching { api.request("POST", "/turns/$old/cancel") } }
    }

    private fun conversationSessionId(pathId: String): String {
        val accountId = account?.text("id") ?: error("계정이 연결되지 않았습니다.")
        val key = "dialog-$accountId-$pathId"
        cache.read(key)?.text("sessionId")?.let { return it }
        return UUID.randomUUID().toString().also { id -> cache.write(key, buildJsonObject { put("sessionId", id) }) }
    }

    fun decide(id: String, accepted: Boolean, source: String = "BUTTON") = work {
        val proposal = proposals[id] ?: error("현재 선택할 수 없는 변경안입니다.")
        val p = requirePath()
        requireApi().request("PUT", "/paths/${p.text("id")}/guidance", guidanceJson(navigation.observed.value))
        if (proposal.number("baseRevision") != p.number("revision")) error("경로가 변경되어 제안을 다시 확인해야 합니다.")
        val observed = navigation.observed.value
        if (accepted && observed.refreshing) error("현재 내비 상태를 확인 중이에요. 잠시 뒤 다시 적용해 주세요.")
        val expected = proposal.text("guidanceFingerprint")
        if (accepted && expected != null && expected != navigation.observed.value.fingerprint) error("실제 내비 경로가 달라졌습니다. 변경안을 다시 요청해 주세요.")
        val result = requireApi().request("POST", "/decisions/$id", buildJsonObject {
            put("accepted", accepted); put("baseRevision", p.number("revision")); put("operationId", operationId()); put("source", source)
            put("guidanceFingerprint", navigation.observed.value.fingerprint)
        })
        proposals.remove(id); publishChoices()
        if (accepted) {
            path = result["path"]?.jsonObject ?: requireApi().request("GET", "/paths/${p.text("id")}")
            val action = result["action"]?.jsonObject?.text("id")
            val request = journey.applyAgentRoute(toJourney(path!!), applyToNavigation = true)
            if (action != null) {
                if (request != null) { navigationActions[request] = action; reportAction(action, "DISPATCHED") }
                else reportAction(action, "UNKNOWN", "계획은 저장했으나 차량 내비 요청은 접수되지 않았습니다.")
            }
            mutable.update { it.copy(notice = "변경 계획을 저장했습니다. 실제 안내 반영을 확인합니다.", phase = AgentUiPhase.IDLE) }
        }
        refresh()
        if (proposal.text("turnId") != null) {
            resumeDecisionId = id
            submit(if (accepted) "이 변경안을 승인해." else "이 변경안은 취소해.")
        }
    }
    fun editRoute(stops: List<RouteStop>) = work {
        check(mutable.value.editable) { "정차 후 경로를 편집해 주세요." }
        val p = requirePath(); val route = journey.state.value.route.copy(stops = stops)
        val guiding = navigation.observed.value.status in setOf(ObservedGuidanceStatus.GUIDING, ObservedGuidanceStatus.SIMULATION)
        if (guiding) {
            requireApi().request("PUT", "/paths/${p.text("id")}/guidance", guidanceJson(navigation.observed.value))
            val proposal = requireApi().request("POST", "/paths/${p.text("id")}/proposals", buildJsonObject {
                put("baseRevision", p.number("revision")); put("stops", routeJson(route)["stops"]!!); put("reason", "수동 경로 변경")
                put("guidanceFingerprint", navigation.observed.value.fingerprint); put("operationId", operationId())
            })
            val id = proposal.text("id")!!; proposals[id] = proposal
            // The user's explicit Apply is already approval. No second confirmation for this manual edit.
            decide(id, true, "MANUAL")
        } else {
            val body = buildJsonObject {
                put("baseRevision", p.number("revision")); put("title", p.text("title")); put("mode", p.text("mode")); put("stops", routeJson(route)["stops"]!!); put("operationId", operationId())
            }
            try {
                path = requireApi().request("PUT", "/paths/${p.text("id")}", body)
                cache.write(draftKey(p.text("id")!!), null)
            } catch (offline: java.io.IOException) {
                // Only plan drafts can enter this outbox. Approval/vehicle writes are never automatically replayed.
                cache.write(draftKey(p.text("id")!!), body)
                path = JsonObject(p + ("stops" to body["stops"]!!))
                journey.applyAgentRoute(toJourney(path!!)); cacheSession()
                mutable.update { it.copy(notice = "오프라인 초안을 보관했습니다. 새로고침하면 최신 버전과 대조해 저장합니다.") }
                return@work
            }
            journey.applyAgentRoute(toJourney(path!!)); refresh()
        }
    }
    fun saveMemory(text: String) = work {
        requireApi().request("POST", "/memory", buildJsonObject { put("text", text); put("pathId", requirePath().text("id")); put("kind", "USER_FACT"); put("operationId", operationId()) }); refresh()
    }
    fun updateMemory(id: String, text: String) = work {
        val note = notes.firstOrNull { it.text("id") == id } ?: error("기억을 다시 불러와 주세요.")
        requireApi().request("PUT", "/memory/$id", buildJsonObject { put("text", text); put("baseRevision", note.number("revision")); put("operationId", operationId()) }); refresh()
    }
    fun deleteMemory(id: String) = work {
        val note = notes.firstOrNull { it.text("id") == id } ?: return@work
        requireApi().request("DELETE", "/memory/$id", buildJsonObject { put("baseRevision", note.number("revision")); put("operationId", operationId()) }); refresh()
    }
    fun addMaterial(name: String, text: String) = uploadMaterial(if (name.endsWith(".txt")) name else "$name.txt", text.toByteArray(Charsets.UTF_8), "text/plain")
    fun uploadMaterial(name: String, bytes: ByteArray, mime: String) = work {
        requireApi().upload(name, bytes, mime, requirePath().text("id")!!); refresh()
    }
    fun deleteMaterial(id: String) = work {
        val material = materials.firstOrNull { it.text("id") == id } ?: return@work
        requireApi().request("DELETE", "/materials/$id", buildJsonObject { put("baseRevision", material.number("revision")); put("operationId", operationId()); put("confirmed", true) }); refresh()
    }
    private fun draftKey(pathId: String) = "draft-${account?.text("id") ?: "none"}-$pathId"
    fun refreshAccount() = work {
        path?.let { previous ->
            val id = previous.text("id")!!
            val latest = requireApi().request("GET", "/paths/$id")
            val draft = cache.read(draftKey(id))
            if (draft != null) {
                if (draft.number("baseRevision") != latest.number("revision")) error("서버 경로도 변경됐습니다. 오프라인 초안을 보존했으니 경로를 비교해 다시 저장해 주세요.")
                path = requireApi().request("PUT", "/paths/$id", draft)
                cache.write(draftKey(id), null)
            } else path = latest
            journey.applyAgentRoute(toJourney(path!!))
        }
        refresh()
    }
    fun selectPath(id: String) = work {
        interrupt(); resumeDecisionId = null
        path = requireApi().request("GET", "/paths/$id")
        journey.applyAgentRoute(toJourney(path!!)); refresh()
    }
    /** Select a saved route and immediately transmit it to Pleos navigation. */
    fun startPath(id: String) = work {
        interrupt(); resumeDecisionId = null
        path = requireApi().request("GET", "/paths/$id")
        journey.startAgentRoute(toJourney(path!!)); refresh()
    }
    fun createPath(title: String) = work {
        interrupt(); resumeDecisionId = null
        val route = journey.state.value.route.copy(title = title)
        path = requireApi().request("POST", "/paths", routeJson(route))
        journey.applyAgentRoute(toJourney(path!!)); refresh()
    }
    fun openNavigationSearch(keyword: String) { scope.launch { navigation.openSearch(keyword) } }
    fun openRouteOptions() { scope.launch { navigation.openRouteOptions() } }
    fun openNavigationForeground() { scope.launch { navigation.openNavigationForeground() } }
    fun showError(message: String) = fail(message)
    fun toggleMicrophone() {
        if (!foreground) return
        if (voice.state.value.listening) { quiet = true; interrupt(); voice.stop(); mutable.update { it.copy(phase = AgentUiPhase.IDLE) } }
        else {
            // Explicitly starting a new microphone session may recover a retired output service.
            // Old callback generations stay isolated in the adapter; no old playback is marked complete.
            if (session.state.value.awaitingStop) {
                session = AgentSession(UUID.randomUUID().toString()); stopGenerations.clear(); playbackOwners.clear(); activePlayback = null
            }
            quiet = false; conversationActive = true; scope.launch { voice.listen() }
        }
    }
    fun setEditingAllowed(allowed: Boolean?) {
        editingAllowed = allowed
        mutable.update { it.copy(editable = journey.state.value.vehicle.origin == DataOrigin.PREVIEW || allowed == true) }
    }
    fun setForeground(active: Boolean) { foreground = active; if (!active) interrupt(true) else session.resumeAudio() }
    fun close() { interrupt(); proactive?.close(); journey.transcriptHandler = null; job.cancel() }
    private fun proactiveContext(): ProactiveContext? {
        val owner = account?.text("id") ?: return null
        val p = path ?: return null
        if (!conversationActive) return null
        val state = journey.state.value; val observed = navigation.observed.value
        val proof = routeEvidence.state.value
        return ProactiveContext(owner, p.text("id")!!, p.number("revision"), observed.routeId, proof.segmentId,
            state.location?.coordinate, state.location?.measuredAtMillis, observed.observedAtMillis, proof.progressMeters,
            headingDegrees = observed.headingDegrees, speedMetersPerSecond = state.location?.speedKph?.div(3.6),
            routeEvidence = if (proof.status == RouteEvidenceStatus.VERIFIED) RouteEvidence.VERIFIED_GUIDANCE_SEGMENT else RouteEvidence.UNKNOWN,
            guiding = observed.status == ObservedGuidanceStatus.GUIDING, audioAvailable = state.vehicle.audioFocusAllowed,
            drivingWindowSafe = proof.drivingWindowSafe, userSpeaking = System.currentTimeMillis() - lastHumanActivityAt < 1_200,
            assistantSpeaking = state.speech.speaking, conversationActive = currentTurn != null,
            quietMode = quiet, foreground = foreground,
            materialVersions = materials.associate { it.text("id")!! to it.number("version") })
    }
    private fun reportPlayback(turnId: String, status: String, chunkId: String? = null) {
        if (api != null && account != null) scope.launch { runCatching { api.request("POST", "/playback", buildJsonObject { put("turnId", turnId); chunkId?.let { put("chunkId", it) }; put("status", if (voice.state.value.origin == DataOrigin.PREVIEW || status == "COMPLETED" && chunkId == null) "UNKNOWN" else status); put("source", voice.state.value.origin.name) }) } }
    }
    private fun reportAction(actionId: String, status: String, error: String? = null) {
        if (api != null) scope.launch { runCatching { api.request("POST", "/actions/$actionId/report", buildJsonObject { put("status", status); put("guidance", guidanceJson(navigation.observed.value)); if (error != null) put("error", error) }) } }
    }
    private fun requireApi() = api ?: error("AI 서버 주소가 설정되지 않았습니다.")
    private fun requirePath() = path ?: error("로그인 후 경로를 불러와 주세요.")
    private fun work(block: suspend () -> Unit) {
        scope.launch { mutations.withLock {
            mutable.update { it.copy(busy = true, notice = null) }
            try { block() } catch (e: CancellationException) { throw e }
            catch (e: Exception) { fail(e.message ?: "요청을 완료하지 못했습니다.") }
            finally { mutable.update { it.copy(busy = false) } }
        } }
    }
    private fun fail(message: String) { mutable.update { it.copy(phase = AgentUiPhase.ERROR, notice = message) } }
    private fun routeJson(route: JourneyRoute) = buildJsonObject {
        put("title", route.title); put("mode", journey.state.value.mode.name)
        putJsonArray("stops") { route.stops.forEach { stop -> add(buildJsonObject {
            put("id", stop.id); put("name", stop.name); put("dwellMinutes", stop.dwellMinutes)
            put("purpose", stop.purpose); stop.appointmentAt?.let { put("appointmentAt", it) }; stop.timeZone?.let { put("timeZone", it) }
            put("memo", stop.memo); put("address", stop.address); put("poiId", stop.poiId)
            putJsonArray("materialIds") { stop.materialIds.forEach { add(it) } }
            putJsonArray("memoryIds") { stop.memoryIds.forEach { add(it) } }
            stop.coordinate?.let { c -> putJsonObject("coordinate") { put("latitude", c.latitude); put("longitude", c.longitude) } }
        }) } }
    }
    private fun toJourney(document: JsonObject) = JourneyRoute(document.text("id")!!, document.text("title").orEmpty(), document.objects("stops").map { stop ->
        val c = stop["coordinate"]?.jsonObject
        RouteStop(stop.text("id")!!, stop.text("name").orEmpty(), c?.let { Coordinate(it["latitude"]!!.jsonPrimitive.double, it["longitude"]!!.jsonPrimitive.double) }, dwellMinutes = stop.number("dwellMinutes").toInt(), purpose = stop.text("purpose").orEmpty(), appointmentAt = stop.text("appointmentAt"), timeZone = stop.text("timeZone"), materialIds = stop["materialIds"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty(), memoryIds = stop["memoryIds"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty(), memo = stop.text("memo").orEmpty(), address = stop.text("address").orEmpty(), poiId = stop.text("poiId") ?: "0")
    }, origin = DataOrigin.USER, durationMinutes = 0, distanceKm = 0.0)
    private fun guidanceJson(observed: ObservedGuidance) = buildJsonObject {
        put("refreshing", observed.refreshing); put("status", observed.status.name); observed.routeId?.let { put("routeId", it) }; put("fingerprint", observed.fingerprint)
        put("observedAt", Instant.ofEpochMilli(observed.observedAtMillis ?: System.currentTimeMillis()).toString()); put("source", observed.origin.name)
        put("stops", routeJson(journey.state.value.route.copy(stops = observed.stops))["stops"]!!)
    }
}
