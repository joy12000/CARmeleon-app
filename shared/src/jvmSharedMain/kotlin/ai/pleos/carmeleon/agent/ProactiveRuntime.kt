package ai.pleos.carmeleon.agent

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant

enum class ProactiveRuntimePhase { HELD, PREPARING, READY, SPEAKING }
data class ProactiveRuntimeState(
    val phase: ProactiveRuntimePhase = ProactiveRuntimePhase.HELD,
    val reason: String = "실제 안내 구간을 기다리고 있습니다.",
    val preparedCount: Int = 0,
    val activeUtteranceId: String? = null,
    val lastPoint: GuidePoint? = null,
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val cacheHits: Int = 0,
)

/**
 * Wires verified road inputs to rolling server preparation and local speech timing.
 * The default unsupported provider keeps this held; OEM routePoints are never fabricated
 * into geometry. The speak callback returns false when audio cannot actually be submitted.
 */
class ProactiveRuntime(
    parentScope: CoroutineScope,
    private val api: AgentHttpClient,
    private val provider: RouteEvidenceProvider,
    private val context: () -> ProactiveContext?,
    private val guidanceFingerprint: () -> String?,
    private val speak: (PreparedUtterance) -> Boolean,
) {
    private val job = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + job)
    private val mutex = Mutex()
    private val mutable = MutableStateFlow(ProactiveRuntimeState())
    val state: StateFlow<ProactiveRuntimeState> = mutable.asStateFlow()
    private var scheduler: ProactiveScheduler? = null
    private var identity: String? = null
    private var lastRevision: Long? = null
    private var retryAfter = 0L
    private val syncedStatuses = mutableMapOf<String, NarrativeStatus>()
    val lastReferencedPoint: GuidePoint? get() = scheduler?.lastReferencedPoint

    init {
        scope.launch { provider.state.collect { cycle() } }
        scope.launch {
            while (true) { cycle(); delay(2_000) }
        }
    }

    fun refresh() { scope.launch { cycle() } }
    fun completed(utteranceId: String) {
        scope.launch { mutex.withLock { if (scheduler?.complete(utteranceId) == true) syncStatuses() }; refresh() }
    }
    fun interrupted(utteranceId: String) {
        scope.launch { mutex.withLock { if (scheduler?.interrupt(utteranceId) == true) syncStatuses() }; refresh() }
    }
    fun invalidate(newRevision: Long, affectedSegments: Set<String>, changedMaterialIds: Set<String> = emptySet()) {
        scope.launch {
            mutex.withLock {
                scheduler?.invalidate(newRevision, affectedSegments, changedMaterialIds)
                lastRevision = newRevision
                syncStatuses()
            }
            refresh()
        }
    }
    fun close() { scope.cancel(); provider.close() }

    private suspend fun cycle() = mutex.withLock {
        try {
            val local = context() ?: return@withLock hold("계정과 경로를 먼저 연결해 주세요.")
            val proof = provider.state.value
            if (proof.status != RouteEvidenceStatus.VERIFIED)
                return@withLock hold(proof.message)
            if (proof.routeId != local.routeId || proof.segmentId != local.segmentId ||
                proof.progressMeters == null || proof.observedAt == null ||
                System.currentTimeMillis() - proof.observedAt !in 0L..15_000L)
                return@withLock hold("실제 안내와 경로 공급자의 구간을 다시 확인해야 합니다.")
            val fingerprint = guidanceFingerprint()?.takeIf { it.isNotBlank() }
                ?: return@withLock hold("실제 안내의 기준 상태가 없습니다.")
            val checked = local.copy(progressMeters = proof.progressMeters,
                routeEvidence = RouteEvidence.VERIFIED_GUIDANCE_SEGMENT)
            val key = "${local.accountId}|${local.pathId}|${proof.routeId}|${proof.segmentId}"
            if (identity != key) {
                scheduler = restore(checked, proof)
                identity = key
                lastRevision = local.pathRevision
                retryAfter = 0
            }
            val active = scheduler ?: return@withLock
            if (lastRevision != local.pathRevision) {
                // If the caller did not provide affected segment IDs, conservatively expire
                // the current segment. The explicit invalidate API retains unaffected scripts.
                active.invalidate(local.pathRevision, setOfNotNull(proof.segmentId))
                lastRevision = local.pathRevision
            }
            val now = System.currentTimeMillis()
            val window = active.preparationWindow(proof.points, checked, now)
            syncStatuses()
            if (window.candidates.isNotEmpty() && now >= retryAfter) {
                if (window.candidates.any { point -> point.sources.any { ref ->
                    ref.text.isNullOrBlank() && !(ref.materialId != null && ref.version != null && ref.page != null)
                } }) return@withLock hold("검증된 장소 본문이나 읽을 수 있는 자료 페이지가 필요합니다.")
                window.candidates.forEach { active.reservePreparation(it.id) }
                mutable.value = mutable.value.copy(phase = ProactiveRuntimePhase.PREPARING,
                    reason = "앞 구간의 짧은 설명을 준비하고 있습니다.")
                try {
                    val response = api.request("POST", "/narratives/prepare", buildJsonObject {
                        put("pathId", local.pathId); put("baseRevision", local.pathRevision)
                        put("routeId", proof.routeId); put("guidanceFingerprint", fingerprint)
                        put("segmentId", proof.segmentId)
                        putJsonArray("points") { window.candidates.forEach { point -> add(pointJson(point, checked)) } }
                    })
                    scope.coroutineContext.ensureActive()
                    val current = context()
                    if (current != null && current.accountId == local.accountId && current.pathId == local.pathId &&
                        current.pathRevision == local.pathRevision && current.routeId == local.routeId) {
                        response.objects("utterances").forEach { item ->
                            parseUtterance(item, window.candidates, local)?.let { active.store(it, current, System.currentTimeMillis()) }
                        }
                        val usage = response["usage"] as? JsonObject
                        mutable.value = mutable.value.copy(
                            inputTokens = mutable.value.inputTokens + (usage?.number("inputTokens") ?: 0),
                            outputTokens = mutable.value.outputTokens + (usage?.number("outputTokens") ?: 0),
                            cacheHits = mutable.value.cacheHits + if (response["cacheHit"]?.jsonPrimitive?.booleanOrNull == true) 1 else 0)
                    }
                } finally { window.candidates.forEach { active.preparationFailed(it.id) } }
            }
            val fresh = context() ?: return@withLock hold("계정 연결이 바뀌었습니다.")
            val latestProof = provider.state.value
            if (fresh.accountId != local.accountId || fresh.pathId != local.pathId || latestProof.routeId != proof.routeId ||
                latestProof.segmentId != proof.segmentId || latestProof.status != RouteEvidenceStatus.VERIFIED ||
                latestProof.observedAt == null || System.currentTimeMillis() - latestProof.observedAt !in 0L..15_000L)
                return@withLock hold("경로가 바뀌거나 오래되어 설명을 다시 확인합니다.")
            when (val decision = active.evaluate(fresh.copy(progressMeters = latestProof.progressMeters,
                routeEvidence = RouteEvidence.VERIFIED_GUIDANCE_SEGMENT), System.currentTimeMillis())) {
                is ProactiveDecision.Speak -> {
                    if (speak(decision.utterance)) {
                        mutable.value = mutable.value.copy(phase = ProactiveRuntimePhase.SPEAKING, reason = "설명 중",
                            activeUtteranceId = decision.utterance.id, lastPoint = decision.utterance.point)
                    } else {
                        active.interrupt(decision.utterance.id)
                        hold("현재 오디오를 사용할 수 없어 이 설명을 건너뜁니다.")
                    }
                }
                is ProactiveDecision.Hold -> hold(decision.reason)
                is ProactiveDecision.NothingReady -> mutable.value = mutable.value.copy(
                    phase = if (active.snapshot.utterances.any { it.status == NarrativeStatus.PREPARED })
                        ProactiveRuntimePhase.READY else ProactiveRuntimePhase.HELD,
                    reason = decision.reason, activeUtteranceId = null)
            }
            mutable.value = mutable.value.copy(preparedCount = active.snapshot.utterances.count { it.status == NarrativeStatus.PREPARED })
            syncStatuses()
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            retryAfter = System.currentTimeMillis() + 30_000
            hold(error.message ?: "설명 준비 연결을 확인해 주세요.")
        }
    }

    private suspend fun restore(local: ProactiveContext, proof: RouteEvidenceSnapshot): ProactiveScheduler {
        val response = api.request("GET", "/narratives?pathId=${URLEncoder.encode(local.pathId, StandardCharsets.UTF_8.name())}")
        val restored = response.objects("utterances").mapNotNull { parseUtterance(it, proof.points, local) }
        syncedStatuses.clear()
        restored.forEach { syncedStatuses[it.id] = it.status }
        val last = restored.filter { it.status in setOf(NarrativeStatus.SPEAKING, NarrativeStatus.COMPLETED, NarrativeStatus.INTERRUPTED) }
            .maxByOrNull { it.createdAt }
        return ProactiveScheduler(local.accountId, local.pathId,
            NarrativePlan(local.accountId, local.pathId, restored, last?.createdAt, last?.point?.id))
    }

    private suspend fun syncStatuses() {
        scheduler?.snapshot?.utterances?.forEach { item ->
            if (item.status in setOf(NarrativeStatus.CANDIDATE, NarrativeStatus.PREPARING, NarrativeStatus.PREPARED) ||
                syncedStatuses[item.id] == item.status) return@forEach
            api.request("POST", "/narratives/${item.id}/status", buildJsonObject {
                put("status", item.status.name); item.statusReason?.let { put("reason", it) }
            })
            syncedStatuses[item.id] = item.status
        }
    }

    private fun hold(reason: String) { mutable.value = mutable.value.copy(phase = ProactiveRuntimePhase.HELD, reason = reason) }
    private fun pointJson(point: GuidePoint, local: ProactiveContext): JsonObject = buildJsonObject {
        put("id", point.id); put("name", point.name)
        putJsonObject("coordinate") { put("latitude", point.coordinate.latitude); put("longitude", point.coordinate.longitude) }
        val ahead = (point.progressMeters - (local.progressMeters ?: 0.0)).coerceAtLeast(0.0)
        put("distanceAheadMeters", ahead)
        local.speedMetersPerSecond?.takeIf { it > 0 }?.let { put("etaSeconds", ahead / it) }
        point.expectedHeadingDegrees?.let { put("headingDegrees", it) }
        putJsonArray("sources") { point.sources.forEach { ref -> add(sourceJson(ref)) } }
    }

    private fun sourceJson(ref: SourceReference): JsonObject = buildJsonObject {
        ref.materialId?.let { put("materialId", it) }; ref.version?.let { put("version", it) }
        ref.page?.let { put("page", it) }; ref.url?.let { put("url", it) }; ref.text?.let { put("text", it) }
    }
    private fun parseUtterance(item: JsonObject, points: List<GuidePoint>, local: ProactiveContext): PreparedUtterance? {
        if (item.text("pathId") != local.pathId) return null
        val point = points.firstOrNull { it.id == item.text("pointId") && it.routeId == item.text("routeId") } ?: return null
        val id = item.text("id") ?: return null
        val text = item.text("text") ?: return null
        val expires = item.text("expiresAt")?.let(::parseTime) ?: return null
        val created = item.text("createdAt")?.let(::parseTime) ?: return null
        val sources = item.objects("sources").map { source -> SourceReference(
            materialId = source.text("materialId"), version = source["version"]?.jsonPrimitive?.longOrNull,
            page = source["page"]?.jsonPrimitive?.intOrNull, url = source.text("url"), text = source.text("text")) }
        val status = item.text("status")?.let { runCatching { NarrativeStatus.valueOf(it) }.getOrNull() } ?: return null
        return PreparedUtterance(id, local.accountId, local.pathId, item.number("pathRevision"), point,
            text, sources, created, expires, status = status, statusReason = item.text("reason"))
    }
    private fun parseTime(value: String): Long? = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
}
