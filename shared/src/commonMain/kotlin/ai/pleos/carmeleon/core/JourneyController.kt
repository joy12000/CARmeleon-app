package ai.pleos.carmeleon.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.math.ceil
import kotlin.math.max

/** One owner for confirmed route, proposed changes and callback-correlated navigation. */
class JourneyController(
    scope: CoroutineScope,
    private val navigation: NavigationGateway,
    private val location: LocationGateway? = null,
    private val voice: VoiceGateway? = null,
    private val vehicle: VehicleGateway? = null,
    private val repository: JourneyRepository? = null,
    initialRoute: JourneyRoute = sampleRoute(),
    private val requestTimeoutMillis: Long = 15_000,
) {
    private val lifecycle = SupervisorJob(scope.coroutineContext[Job])
    private val scope = CoroutineScope(scope.coroutineContext + lifecycle)
    private val mutable = MutableStateFlow(JourneyState(route = initialRoute, backend = BackendState(baseUrl = repository?.baseUrl.orEmpty())))
    val state: StateFlow<JourneyState> = mutable.asStateFlow()
    private val mutex = Mutex()
    private val subscriptions = mutableListOf<Job>()
    private var requestCounter = 0L
    private var released = false
    private var findingGeneration = 0L
    private var pending: Attempt? = null
    private var lastAttempt: Attempt? = null
    private var activeRequest: NavigationRequest? = null
    private var activeSegmentStart = 0
    private var approvedRoute: JourneyRoute? = null
    private val completedStops = mutableMapOf<String, MutableSet<String>>()
    private var requestTimer: Job? = null
    private var heldSpeech: String? = null
    private var foreground = true
    var transcriptHandler: ((String) -> Unit)? = null

    /** Refreshing desired intent must not revoke the owner of the actual guidance callbacks. */
    suspend fun applyAgentRoute(route: JourneyRoute, applyToNavigation: Boolean = false): String? = mutex.withLock {
        check(!released)
        require(route.isNavigable) { "모든 장소에 이름과 유효한 좌표가 필요합니다." }
        ++findingGeneration
        val samePlan = route.id == mutable.value.route.id
        mutable.update { it.copy(route = route, proposal = null, proposalVisible = false,
            currentStopIndex = nextStopIndex(route), acceptedDetour = if (samePlan) it.acceptedDetour else false,
            phase = when {
                pending?.candidate?.id == route.id -> JourneyPhase.REQUESTING
                activeRequest != null && approvedRoute?.id == route.id -> JourneyPhase.DRIVING
                nextStopIndex(route) == route.stops.size -> JourneyPhase.ARRIVED
                else -> JourneyPhase.READY
            }, error = null) }
        if (applyToNavigation) {
            check(pending == null) { "이전 내비 요청의 결과를 먼저 확인해 주세요." }
            beginRequest(route, null, nextStopIndex(route), commitPlanOnCompletion = false)
        }
        pending?.takeIf { applyToNavigation && it.candidate.id == route.id }?.request?.requestId
    }

    /** Apply a chosen route from the saved list and immediately transmit it to navigation. */
    suspend fun startAgentRoute(route: JourneyRoute): String? = mutex.withLock {
        check(!released)
        require(route.isNavigable) { "모든 장소에 이름과 유효한 좌표가 필요합니다." }
        ++findingGeneration
        pending?.let { attempt ->
            pending = null; requestTimer?.cancel(); requestTimer = null
            scope.launch { runCatching { navigation.cancel(attempt.request.requestId) } }
        }
        mutable.update {
            it.copy(
                route = route,
                proposal = null,
                proposalVisible = false,
                currentStopIndex = nextStopIndex(route),
                acceptedDetour = false,
                pendingRequestId = null,
                error = null,
            )
        }
        beginRequest(route, null, nextStopIndex(route), commitPlanOnCompletion = false)
        pending?.takeIf { it.candidate.id == route.id }?.request?.requestId
    }

    private fun nextStopIndex(route: JourneyRoute): Int = route.stops.indexOfFirst {
        it.id !in completedStops[route.id].orEmpty()
    }.let { if (it < 0) route.stops.size else it }

    private fun recordArrival(route: JourneyRoute, stopIds: List<String>) {
        completedStops.getOrPut(route.id) { mutableSetOf() }.addAll(stopIds)
        if (mutable.value.route.id == route.id) mutable.update {
            it.copy(currentStopIndex = nextStopIndex(it.route))
        }
    }

    private data class Attempt(val request: NavigationRequest, val candidate: JourneyRoute,
        val proposal: RouteProposal?, val segmentStart: Int, val commitPlanOnCompletion: Boolean = true)

    init {
        require(requestTimeoutMillis > 0)
        subscriptions += scope.launch { navigation.connection.collect { value -> if (!released) mutable.update { it.copy(connection = value) } } }
        subscriptions += scope.launch { navigation.events.collect { event -> mutex.withLock { handleNavigationEvent(event) } } }
        location?.let { gateway -> subscriptions += scope.launch { gateway.fixes.collect { fix -> if (!released) mutable.update { it.copy(location = fix?.takeIf { f -> f.coordinate.isValid }) } } } }
        voice?.let { gateway ->
            subscriptions += scope.launch { gateway.state.collect { value -> if (!released) mutable.update { it.copy(speech = value) } } }
            subscriptions += scope.launch { gateway.transcripts.collect { text -> if (!released) handleTranscript(text) } }
        }
        vehicle?.let { gateway -> subscriptions += scope.launch { gateway.state.collect { snapshot ->
            if (released) return@collect
            val wasAllowed = mutable.value.vehicle.canSpeak
            val wasOtherwiseSafe = mutable.value.vehicle.copy(audioFocusAllowed = true).canSpeak
            mutable.update { it.copy(vehicle = snapshot) }
            if (!snapshot.canSpeak) voice?.stop()
            if ((!wasAllowed && snapshot.canSpeak) || (!wasOtherwiseSafe && snapshot.copy(audioFocusAllowed = true).canSpeak))
                heldSpeech?.let { text -> heldSpeech = null; speak(text) }
        } } }
    }

    fun clearPlannedRoute() = command {
        ++findingGeneration; pending = null; activeRequest = null; approvedRoute = null; completedStops.clear(); requestTimer?.cancel()
        mutable.update { it.copy(route = JourneyRoute("unconfigured", "이동 계획", emptyList(), durationMinutes = 0, distanceKm = 0.0, departureName = ""),
            proposal = null, proposalVisible = false, phase = JourneyPhase.READY, pendingRequestId = null, currentStopIndex = 0, acceptedDetour = false) }
    }

    fun connect() {
        if (released) return
        scope.launch { safelyConnect { navigation.connect() } }
        location?.let { scope.launch { safelyConnect { it.connect() } } }
        vehicle?.let { scope.launch { safelyConnect { it.connect() } } }
    }

    private suspend fun safelyConnect(block: suspend () -> Unit) {
        try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) {
            if (!released) mutable.update { it.copy(error = e.message ?: "차량 서비스에 연결하지 못했습니다.") }
        }
    }

    fun chooseMode(mode: TravelMode) = command {
        mutable.update { it.copy(mode = mode, proposal = it.proposal?.let { p -> p.copy(reason = reason(mode, p.kind)) }, message = when (mode) {
            TravelMode.TRAVEL -> "가는 길의 이야기와 여행 일정을 함께 살펴볼게요."
            TravelMode.BUSINESS -> "다음 약속과 이동 시간을 함께 챙길게요."
            TravelMode.DAILY -> "오늘도 편하게 함께 갈게요."
        }) }
    }

    fun start() = command {
        if (pending != null) return@command
        beginRequest(mutable.value.route, null, mutable.value.currentStopIndex)
    }

    fun propose(kind: PoiKind) {
        if (released) return
        scope.launch {
            val generation = mutex.withLock {
                if (pending != null) return@launch
                ++findingGeneration
                mutable.update { it.copy(busyFinding = true, error = null, message = "가는 길과 남은 일정을 살펴보고 있어요.") }
                findingGeneration
            }
            val snapshot = mutable.value
            var backendError: String? = null
            val candidates = try {
                repository?.nearby(kind, snapshot.location?.coordinate).orEmpty()
            } catch (e: CancellationException) { throw e } catch (e: Exception) { backendError = e.message ?: "서버 추천을 불러오지 못했습니다."; emptyList() }
            mutex.withLock {
                if (released || generation != findingGeneration || pending != null) return@withLock
                val origin = snapshot.location?.coordinate ?: if (snapshot.route.origin == DataOrigin.PREVIEW) Coordinate(37.3948, 127.1119) else null
                val destination = snapshot.route.destination?.coordinate
                val valid = candidates.filter { it.stop.coordinate?.isValid == true }
                val chosen = valid.minByOrNull { candidate ->
                    val point = candidate.stop.coordinate!!
                    if (origin != null && destination != null) origin.distanceKm(point) + point.distanceKm(destination) else candidate.distanceKm ?: Double.MAX_VALUE
                } ?: previewCandidate(kind)
                val driving = if (chosen.origin == DataOrigin.PREVIEW) previewExtraMinutes(kind) else if (origin != null && destination != null) {
                    val extraKm = max(0.0, origin.distanceKm(chosen.stop.coordinate!!) + chosen.stop.coordinate.distanceKm(destination) - origin.distanceKm(destination))
                    max(1, ceil(extraKm / 30.0 * 60.0).toInt())
                } else chosen.durationMinutes?.coerceAtLeast(1) ?: 6
                val dwell = chosen.stop.dwellMinutes.takeIf { it > 0 } ?: defaultDwell(kind)
                val proposal = RouteProposal(chosen.stop.copy(kind = kind, dwellMinutes = dwell), kind, driving, dwell,
                    snapshot.route.arrivalMinuteOfDay + driving + dwell, chosen.origin,
                    reason(snapshot.mode, kind), chosen.detail, estimatesOnly = true)
                val alreadyAccepted = snapshot.acceptedDetour && snapshot.route.stops.drop(snapshot.currentStopIndex).any { it.id == chosen.stop.id }
                mutable.update { it.copy(proposal = if (alreadyAccepted) proposal.copy(arrivalMinuteOfDay = snapshot.route.arrivalMinuteOfDay) else proposal,
                    proposalVisible = true, phase = if (alreadyAccepted) JourneyPhase.CONFIRMED else JourneyPhase.PROPOSAL, busyFinding = false,
                    message = if (alreadyAccepted) "이미 경로에 추가된 장소예요. 기존 도착 예상 시각을 유지합니다." else if (chosen.origin == DataOrigin.PREVIEW) "예시 장소와 예상 시간으로 변경안을 보여드려요." else "서버 예시 장소를 경로와 비교했어요. 이동 시간은 추정치입니다.",
                    backend = if (backendError != null) it.backend.copy(loading = false, connected = false, message = backendError!!) else it.backend) }
            }
        }
    }

    fun dismissProposal() = command {
        if (pending != null) return@command
        ++findingGeneration
        mutable.update { it.copy(proposalVisible = false, busyFinding = false, phase = if (activeRequest != null) JourneyPhase.DRIVING else JourneyPhase.READY, error = null) }
    }

    fun approveProposal() = command {
        if (pending != null || mutable.value.busyFinding) return@command
        val s = mutable.value
        val proposal = s.proposal ?: return@command
        val remaining = s.route.stops.drop(s.currentStopIndex)
        if (remaining.isEmpty()) { failWithoutRequest("먼저 목적지가 있는 일정을 선택해 주세요."); return@command }
        // Reopening an already committed suggestion must never duplicate the stop.
        if (remaining.any { it.id == proposal.stop.id }) { mutable.update { it.copy(proposalVisible = false, phase = JourneyPhase.DRIVING) }; return@command }
        val stops = s.route.stops.take(s.currentStopIndex) + listOf(proposal.stop) + remaining
        val candidate = s.route.copy(stops = stops, arrivalMinuteOfDay = proposal.arrivalMinuteOfDay,
            durationMinutes = s.route.durationMinutes + proposal.extraDrivingMinutes + proposal.dwellMinutes)
        beginRequest(candidate, proposal, s.currentStopIndex)
    }

    fun retry() = command {
        if (pending != null) return@command
        val attempt = lastAttempt
        if (attempt != null) beginRequest(attempt.candidate, attempt.proposal, attempt.segmentStart) else beginRequest(mutable.value.route, null, mutable.value.currentStopIndex)
    }

    fun cancelPending() = command {
        val attempt = pending ?: return@command
        pending = null; requestTimer?.cancel(); requestTimer = null
        mutable.update { it.copy(pendingRequestId = null, phase = if (activeRequest == null) JourneyPhase.READY else JourneyPhase.DRIVING, message = "요청을 취소했어요. 기존 일정은 유지합니다.", error = null) }
        scope.launch { runCatching { navigation.cancel(attempt.request.requestId) } }
    }

    fun continueJourney() = command {
        if (pending == null) mutable.update { it.copy(proposalVisible = false, phase = if (activeRequest != null) JourneyPhase.DRIVING else JourneyPhase.READY) }
    }

    fun onNavigationEvent(event: NavigationEvent) = command { handleNavigationEvent(event) }

    private fun beginRequest(candidate: JourneyRoute, proposal: RouteProposal?, segmentStart: Int, commitPlanOnCompletion: Boolean = true) {
        ++findingGeneration
        mutable.update { it.copy(busyFinding = false) }
        if (!candidate.isNavigable) { failWithoutRequest("일정의 모든 장소에 유효한 위도·경도가 필요합니다."); return }
        val segment = candidate.stops.drop(segmentStart).filter { it.id !in completedStops[candidate.id].orEmpty() }.take(3)
        if (segment.isEmpty()) {
            if (mutable.value.route.id == candidate.id) mutable.update { it.copy(phase = JourneyPhase.ARRIVED, currentStopIndex = candidate.stops.size) }
            return
        }
        val request = NavigationRequest("route-${++requestCounter}", segment.last(), segment.dropLast(1))
        request.validationError()?.let { failWithoutRequest(it); return }
        val attempt = Attempt(request, candidate, proposal, segmentStart, commitPlanOnCompletion)
        lastAttempt = attempt
        if (mutable.value.connection.status != ConnectionStatus.CONNECTED) { failWithoutRequest("내비게이션 서비스가 연결되지 않았습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요."); return }
        pending = attempt; lastAttempt = attempt
        mutable.update { it.copy(phase = JourneyPhase.REQUESTING, pendingRequestId = request.requestId, error = null, message = "내비게이션에 경로를 요청했어요. 처리 결과를 기다립니다.") }
        requestTimer?.cancel()
        requestTimer = scope.launch {
            delay(requestTimeoutMillis)
            mutex.withLock {
                if (pending?.request?.requestId == request.requestId) {
                    pending = null
                    mutable.update { it.copy(phase = JourneyPhase.FAILED, pendingRequestId = null, error = "내비게이션 응답 시간이 지났습니다. 기존 경로를 유지합니다.") }
                    scope.launch { runCatching { navigation.cancel(request.requestId) } }
                }
            }
        }
        scope.launch {
            try { navigation.request(request) } catch (e: CancellationException) { throw e } catch (e: Exception) {
                onNavigationEvent(NavigationEvent.Failed(request.requestId, e.message ?: "경로 요청을 보내지 못했습니다."))
            }
        }
    }

    private fun handleNavigationEvent(event: NavigationEvent) {
        if (released) return
        val attempt = pending
        if (attempt != null && event.requestId == attempt.request.requestId) {
            when (event) {
                is NavigationEvent.Requested -> mutable.update { it.copy(message = "내비게이션이 경로 탐색을 시작했습니다.") }
                is NavigationEvent.Completed -> {
                    pending = null; requestTimer?.cancel(); requestTimer = null
                    activeRequest = attempt.request; activeSegmentStart = attempt.segmentStart
                    approvedRoute = attempt.candidate
                    if (mutable.value.route.id == attempt.candidate.id) mutable.update {
                        val displayed = if (attempt.commitPlanOnCompletion) attempt.candidate else it.route
                        it.copy(route = displayed, pendingRequestId = null,
                            currentStopIndex = nextStopIndex(displayed),
                            phase = if (attempt.proposal == null) JourneyPhase.DRIVING else JourneyPhase.CONFIRMED,
                            acceptedDetour = it.acceptedDetour || attempt.proposal != null,
                            message = "내비게이션에서 안내 중인 경로를 확인했습니다.", error = null)
                    } else mutable.update { it.copy(pendingRequestId = null) }
                }
                is NavigationEvent.Failed -> { pending = null; requestTimer?.cancel(); requestTimer = null; mutable.update { it.copy(pendingRequestId = null, phase = JourneyPhase.FAILED, error = event.message, message = "경로 변경이 완료되지 않아 기존 일정을 유지합니다.") } }
                is NavigationEvent.Cancelled -> { pending = null; requestTimer?.cancel(); requestTimer = null; mutable.update { it.copy(pendingRequestId = null, phase = JourneyPhase.FAILED, error = "내비게이션 경로 요청이 취소됐습니다.") } }
                else -> Unit
            }
            return
        }
        val active = activeRequest ?: return
        if (event.requestId != active.requestId) return // Superseded, cancelled and duplicate callbacks never commit a route.
        when (event) {
            is NavigationEvent.WaypointArrived -> if (event.stopIndex in active.waypoints.indices) {
                val route = approvedRoute ?: return
                recordArrival(route, active.waypoints.take(event.stopIndex + 1).map { it.id })
            }
            is NavigationEvent.DestinationArrived -> {
                val route = approvedRoute ?: return
                recordArrival(route, (active.waypoints + active.destination).map { it.id })
                activeRequest = null // Duplicate callbacks must not launch another segment.
                val next = nextStopIndex(route)
                if (next >= route.stops.size) {
                    if (mutable.value.route.id == route.id) mutable.update {
                        it.copy(phase = if (nextStopIndex(it.route) == it.route.stops.size) JourneyPhase.ARRIVED else JourneyPhase.READY,
                            message = "승인된 안내 구간을 마쳤습니다.")
                    }
                } else if (pending == null) beginRequest(route, null, next, commitPlanOnCompletion = false)
            }
            else -> Unit
        }
    }

    /** Preview-only manual arrival is exposed separately from actual SDK callbacks. */
    fun markArrived() = command {
        if (mutable.value.connection.origin != DataOrigin.PREVIEW) { failWithoutRequest("실제 차량의 도착은 내비게이션 이벤트로 확인합니다."); return@command }
        activeRequest?.let { handleNavigationEvent(NavigationEvent.DestinationArrived(it.requestId)) }
    }

    fun loadActiveRoute() = backendCommand("일정을 불러오고 있어요.") {
        val route = requireRepository().activeRoute() ?: error("서버에 활성 일정이 없습니다.")
        mutex.withLock {
            if (pending != null || activeRequest != null) error("주행 중에는 일정을 교체할 수 없습니다.")
            ++findingGeneration
            mutable.update { it.copy(route = route, phase = JourneyPhase.READY, proposal = null, proposalVisible = false, currentStopIndex = 0, acceptedDetour = false, error = null) }
        }
    }

    fun saveRoute(route: JourneyRoute) = backendCommand("일정을 저장하고 있어요.") {
        if (!route.isNavigable) error("저장할 일정에 유효한 장소와 좌표가 필요합니다.")
        requireRepository().saveRoute(route)
    }

    fun requestBriefings() = backendCommand("일정 안내를 불러오고 있어요.") {
        val result = requireRepository().briefings(mutable.value.route.id)
        mutable.update { it.copy(briefings = result) }
    }

    fun requestGuide() = backendCommand("동행 이야기를 불러오고 있어요.") {
        val result = requireRepository().guide(mutable.value.location?.coordinate, mutable.value.currentStopIndex)
        mutable.update { it.copy(guide = result) }
    }

    private fun backendCommand(message: String, action: suspend () -> Unit) {
        if (released) return
        scope.launch {
            mutable.update { it.copy(backend = it.backend.copy(loading = true, message = message), error = null) }
            try {
                action()
                if (!released) mutable.update { it.copy(backend = it.backend.copy(loading = false, connected = true, message = "서버 연결됨 · 콘텐츠는 기존 예시 데이터입니다.", origin = DataOrigin.BACKEND_SAMPLE)) }
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                if (!released) mutable.update { it.copy(backend = it.backend.copy(loading = false, connected = false, message = e.message ?: "서버 요청 실패"), error = e.message ?: "서버 요청 실패") }
            }
        }
    }

    private fun requireRepository(): JourneyRepository = repository ?: error("서버 주소가 설정되지 않았습니다.")

    fun listen() {
        if (released || !foreground) return
        scope.launch {
            try { (voice ?: error("음성 입력을 사용할 수 없습니다.")).listen() }
            catch (e: CancellationException) { throw e } catch (e: Exception) { mutable.update { it.copy(error = e.message ?: "음성 입력 실패") } }
        }
    }

    fun speak(text: String) {
        if (released || !foreground || text.isBlank()) return
        val snapshot = mutable.value.vehicle
        if (snapshot.gear == Gear.UNKNOWN || snapshot.gear == Gear.REVERSE || snapshot.navigationSpeaking || snapshot.driverAlert) {
            heldSpeech = text; mutable.update { it.copy(message = it.vehicle.speechHoldReason ?: "음성 안내를 보류합니다.") }; return
        }
        scope.launch {
            try {
                val gateway = voice ?: error("음성 출력을 사용할 수 없습니다.")
                heldSpeech = null // A prepare() focus callback must not replay the same queued sentence.
                val granted = gateway.prepare()
                if (released || !foreground) return@launch
                mutable.update { it.copy(vehicle = it.vehicle.copy(audioFocusAllowed = granted)) }
                if (mutable.value.vehicle.canSpeak) { heldSpeech = null; gateway.speak(text) }
                else { heldSpeech = text; mutable.update { it.copy(message = it.vehicle.speechHoldReason ?: "음성 안내를 보류합니다.") } }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { mutable.update { it.copy(error = e.message ?: "음성 안내 실패") } }
        }
    }

    private fun handleTranscript(raw: String) {
        val text = raw.trim()
        if (text.isBlank()) return
        mutable.update { it.copy(lastTranscript = text) }
        transcriptHandler?.let { it(text); return }
        when {
            listOf("화장실", "휴게소").any { it in text } -> propose(PoiKind.RESTROOM)
            listOf("충전", "배터리").any { it in text } -> propose(PoiKind.CHARGER)
            listOf("배고", "식사", "밥", "맛집").any { it in text } -> propose(PoiKind.MEAL)
            listOf("취소", "그냥", "닫아").any { it in text } -> if (state.value.isPending) cancelPending() else dismissProposal()
            listOf("추가", "들르", "좋아").any { it in text } -> approveProposal()
            else -> mutable.update { it.copy(message = when (it.mode) { TravelMode.TRAVEL -> "가는 길의 여행 이야기와 들를 곳을 함께 살펴봐요."; TravelMode.BUSINESS -> "다음 약속과 필요한 준비를 함께 확인해요."; TravelMode.DAILY -> "편하게 이야기해요. 필요한 곳이 생기면 말해 주세요." }) }
        }
    }

    private fun command(action: suspend () -> Unit) {
        if (!released) scope.launch { mutex.withLock { if (!released) action() } }
    }

    private fun failWithoutRequest(message: String) { mutable.update { it.copy(phase = JourneyPhase.FAILED, error = message, pendingRequestId = null) } }

    /** Backgrounding must never replay a previously deferred utterance. Route state remains intact. */
    fun setForeground(active: Boolean) {
        foreground = active
        if (!active) { heldSpeech = null; voice?.stop() }
    }

    fun release() {
        if (released) return
        released = true; ++findingGeneration; pending = null; activeRequest = null; heldSpeech = null
        requestTimer?.cancel(); subscriptions.forEach { it.cancel() }
        lifecycle.cancel()
        navigation.close(); location?.close(); voice?.close(); vehicle?.close()
    }
}

private fun defaultDwell(kind: PoiKind) = when (kind) { PoiKind.MEAL -> 40; PoiKind.CHARGER -> 25; PoiKind.RESTROOM -> 10 }
private fun previewExtraMinutes(kind: PoiKind) = when (kind) { PoiKind.MEAL -> 6; PoiKind.CHARGER -> 5; PoiKind.RESTROOM -> 3 }
private fun previewCandidate(kind: PoiKind): PoiCandidate {
    val stop = when (kind) {
        PoiKind.MEAL -> RouteStop("preview-meal", "행궁동 작은 식당", Coordinate(37.2828, 127.0141), "경기 수원시 팔달구 행궁동", kind = kind, dwellMinutes = 40)
        PoiKind.CHARGER -> RouteStop("preview-charger", "경로 주변 충전소", Coordinate(37.2934, 127.0234), "충전소 예시 위치", kind = kind, dwellMinutes = 25)
        PoiKind.RESTROOM -> RouteStop("preview-restroom", "가는 길 휴게 공간", Coordinate(37.2861, 127.0173), "화장실 예시 위치", kind = kind, dwellMinutes = 10)
    }
    return PoiCandidate(stop, previewExtraMinutes(kind), null, "실제 영업·가용 상태를 확인하지 않은 시연 장소", DataOrigin.PREVIEW)
}
private fun reason(mode: TravelMode, kind: PoiKind): String = when (mode) {
    TravelMode.TRAVEL -> if (kind == PoiKind.MEAL) "식사 후에도 원래 여행 경로를 이어갈 수 있어요." else "잠깐 쉬고 여행을 이어갈 수 있는 변경안이에요."
    TravelMode.BUSINESS -> "추가 이동과 머무는 시간을 포함한 예상 도착 시각을 확인해 주세요. 약속 시각과 비교한 뒤 결정해요."
    TravelMode.DAILY -> "목적지를 바꾸지 않고 가는 길에 들르는 변경안이에요."
}
