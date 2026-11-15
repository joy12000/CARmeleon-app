package ai.pleos.carmeleon.agent

import ai.pleos.carmeleon.core.Coordinate
import kotlin.math.abs

enum class NarrativeStatus { CANDIDATE, PREPARING, PREPARED, SPEAKING, COMPLETED, INTERRUPTED, SKIPPED, INVALIDATED }
enum class RouteEvidence { VERIFIED_GUIDANCE_SEGMENT, EXTERNAL_ESTIMATE, UNKNOWN }

data class GuidePoint(
    val id: String,
    val placeId: String,
    val name: String,
    val coordinate: Coordinate,
    val segmentId: String,
    val routeId: String,
    val progressMeters: Double,
    val routeEvidence: RouteEvidence,
    val sources: List<SourceReference>,
    val expectedHeadingDegrees: Double? = null,
    val headingToleranceDegrees: Double = 55.0,
    val approachMeters: Double = 500.0,
    val passedToleranceMeters: Double = 40.0,
    val physicalRadiusMeters: Double = 800.0,
    val purpose: String = "여행 설명",
    val materialVersions: Map<String, Long> = emptyMap(),
    val sideOfRoadEvidence: String? = null,
) {
    init {
        require(id.isNotBlank() && placeId.isNotBlank() && name.isNotBlank())
        require(coordinate.isValid && progressMeters.isFinite() && progressMeters >= 0 && approachMeters.isFinite() && approachMeters > 0)
        require(passedToleranceMeters.isFinite() && passedToleranceMeters >= 0 && physicalRadiusMeters.isFinite() && physicalRadiusMeters > 0)
        require(expectedHeadingDegrees == null || expectedHeadingDegrees.isFinite())
        require(headingToleranceDegrees in 0.0..180.0)
    }
}

data class PreparedUtterance(
    val id: String,
    val accountId: String,
    val pathId: String,
    val pathRevision: Long,
    val point: GuidePoint,
    val text: String,
    val sources: List<SourceReference>,
    val createdAt: Long,
    val expiresAt: Long,
    val language: String = "ko",
    val status: NarrativeStatus = NarrativeStatus.PREPARED,
    val statusReason: String? = null,
    val inputTokens: Long? = null,
    val outputTokens: Long? = null,
    val cacheHit: Boolean = false,
) {
    /** Private script cache scope includes account, purpose, source versions, direction and segment. */
    val cacheKey: String get() = listOf(accountId, pathId, point.segmentId, point.routeId,
        point.placeId, language, point.purpose, point.expectedHeadingDegrees?.toString().orEmpty(), point.sideOfRoadEvidence.orEmpty(),
        point.materialVersions.toSortedMap().entries.joinToString { "${it.key}:${it.value}" },
        point.sources.joinToString { "${it.materialId}:${it.version}:${it.page}:${it.url}:${it.text?.hashCode()}" }).joinToString("|")
}

data class NarrativePlan(val accountId: String, val pathId: String,
    val utterances: List<PreparedUtterance>, val lastSpokenAt: Long? = null,
    val lastPointId: String? = null)

/** These are observed inputs, not optimistic defaults. Unknown audio/road state blocks proactive audio. */
data class ProactiveContext(
    val accountId: String,
    val pathId: String,
    val pathRevision: Long,
    val routeId: String?,
    val segmentId: String?,
    val location: Coordinate?,
    val locationMeasuredAt: Long?,
    val guidanceObservedAt: Long?,
    val progressMeters: Double?,
    val headingDegrees: Double? = null,
    val speedMetersPerSecond: Double? = null,
    val routeEvidence: RouteEvidence = RouteEvidence.UNKNOWN,
    val guiding: Boolean = false,
    val audioAvailable: Boolean? = null,
    val drivingWindowSafe: Boolean? = null,
    val userSpeaking: Boolean = false,
    val assistantSpeaking: Boolean = false,
    val conversationActive: Boolean = false,
    val quietMode: Boolean = false,
    val foreground: Boolean = true,
    val materialVersions: Map<String, Long> = emptyMap(),
)

data class PreparationWindow(val candidates: List<GuidePoint>, val alreadyPrepared: List<String>,
    val reason: String? = null)
sealed interface ProactiveDecision {
    data class Speak(val utterance: PreparedUtterance) : ProactiveDecision
    data class Hold(val reason: String) : ProactiveDecision
    data class NothingReady(val reason: String) : ProactiveDecision
}

/**
 * No network/model calls. Prepare at most the next few eligible points, then evaluate locally.
 * Restore [snapshot] after reconnect so repeated GPS fixes cannot replay completed stories.
 */
class ProactiveScheduler(
    val accountId: String,
    val pathId: String,
    restored: NarrativePlan? = null,
    private val maxPreparedPoints: Int = 3,
    private val horizonSeconds: Long = 600,
    private val cooldownMillis: Long = 45_000,
    private val maxLocationAgeMillis: Long = 10_000,
    private val maxGuidanceAgeMillis: Long = 15_000,
) {
    init {
        require(accountId.isNotBlank() && pathId.isNotBlank())
        require(maxPreparedPoints in 1..3 && horizonSeconds in 1..600)
        require(restored == null || restored.accountId == accountId && restored.pathId == pathId)
    }
    private val items = restored?.utterances?.map {
        if (it.status == NarrativeStatus.SPEAKING) it.copy(status = NarrativeStatus.INTERRUPTED,
            statusReason = "재접속으로 이전 재생의 완료 위치를 확인할 수 없습니다.") else it
    }?.associateBy { it.id }?.toMutableMap() ?: mutableMapOf()
    private var lastSpokenAt: Long? = restored?.lastSpokenAt
    private var lastPointId: String? = restored?.lastPointId
    private val preparingPoints = mutableSetOf<String>()
    val snapshot: NarrativePlan get() = NarrativePlan(accountId, pathId, items.values.toList(), lastSpokenAt, lastPointId)
    val lastReferencedPoint: GuidePoint? get() = lastPointId?.let { id -> items.values.lastOrNull { it.point.id == id }?.point }

    fun preparationWindow(candidates: List<GuidePoint>, context: ProactiveContext, now: Long): PreparationWindow {
        identityError(context)?.let { return PreparationWindow(emptyList(), emptyList(), it) }
        routeError(context, now)?.let { return PreparationWindow(emptyList(), emptyList(), it) }
        expireAndSkip(context, now)
        val progress = context.progressMeters!!
        val active = items.values.filter { it.status in setOf(NarrativeStatus.PREPARED, NarrativeStatus.PREPARING, NarrativeStatus.SPEAKING) }
        val already = active.map { it.point.id } + preparingPoints
        val available = (maxPreparedPoints - already.distinct().size).coerceAtLeast(0)
        val pending = candidates.asSequence().distinctBy { it.id }
            .filter { eligiblePoint(it, context) }
            .filter { it.progressMeters >= progress }
            .filter { point -> context.speedMetersPerSecond?.takeIf { it > 0 }?.let { speed ->
                (point.progressMeters - progress) / speed <= horizonSeconds
            } ?: (point.progressMeters - progress <= point.approachMeters) }
            .filter { it.id !in already }
            .filter { point -> items.values.none { it.point.id == point.id &&
                it.point.routeId == point.routeId && it.status in setOf(NarrativeStatus.COMPLETED,
                    NarrativeStatus.INTERRUPTED, NarrativeStatus.SKIPPED) } }
            .sortedBy { it.progressMeters }.take(available).toList()
        return PreparationWindow(pending, already.distinct())
    }

    /** Explicit reservation prevents repeated GPS ticks from starting duplicate model work. */
    fun reservePreparation(pointId: String): Boolean = preparingPoints.add(pointId)
    fun preparationFailed(pointId: String) { preparingPoints.remove(pointId) }

    fun store(utterance: PreparedUtterance, context: ProactiveContext, now: Long): Boolean {
        preparingPoints.remove(utterance.point.id)
        if (identityError(context) != null || utterance.accountId != accountId || utterance.pathId != pathId ||
            utterance.pathRevision != context.pathRevision || !eligiblePoint(utterance.point, context) ||
            utterance.text.isBlank() || utterance.expiresAt <= now || utterance.createdAt > now ||
            utterance.sources.isEmpty() || utterance.sources.any { !it.isIdentifiable } ||
            utterance.status != NarrativeStatus.PREPARED || items.values.count {
                it.status in setOf(NarrativeStatus.PREPARED, NarrativeStatus.PREPARING, NarrativeStatus.SPEAKING)
            } >= maxPreparedPoints) return false
        if (items.containsKey(utterance.id)) return false
        if (items.values.any { it.point.id == utterance.point.id && it.point.routeId == utterance.point.routeId &&
                it.status !in setOf(NarrativeStatus.INVALIDATED) }) return false
        items[utterance.id] = utterance
        return true
    }

    fun evaluate(context: ProactiveContext, now: Long): ProactiveDecision {
        identityError(context)?.let { return ProactiveDecision.NothingReady(it) }
        expireAndSkip(context, now)
        routeError(context, now)?.let { return ProactiveDecision.Hold(it) }
        val active = items.values.firstOrNull { it.status == NarrativeStatus.SPEAKING }
        if (active != null) return ProactiveDecision.Hold("이미 설명을 재생하고 있습니다.")
        if (context.quietMode || !context.foreground) return ProactiveDecision.Hold("설명을 쉬고 있습니다.")
        if (context.userSpeaking || context.assistantSpeaking || context.conversationActive)
            return ProactiveDecision.Hold("대화를 먼저 이어갑니다.")
        if (context.audioAvailable != true) return ProactiveDecision.Hold("오디오 사용 상태를 확인해야 합니다.")
        if (context.drivingWindowSafe != true) return ProactiveDecision.Hold("운전 상황을 확인해야 합니다.")
        if (lastSpokenAt?.let { now - it < cooldownMillis } == true) return ProactiveDecision.Hold("다음 설명까지 잠시 쉽니다.")
        val eligible = items.values.filter { it.status == NarrativeStatus.PREPARED &&
            it.pathRevision == context.pathRevision && eligiblePoint(it.point, context) }
            .sortedBy { it.point.progressMeters }
        val progress = context.progressMeters!!
        val candidate = eligible.firstOrNull { point ->
            val ahead = point.point.progressMeters - progress
            ahead >= -point.point.passedToleranceMeters && ahead <= point.point.approachMeters &&
                context.location!!.distanceKm(point.point.coordinate) * 1000 <= point.point.physicalRadiusMeters &&
                headingMatches(point.point, context.headingDegrees)
        } ?: return ProactiveDecision.NothingReady("지금 설명할 검증된 지점이 없습니다.")
        val speaking = candidate.copy(status = NarrativeStatus.SPEAKING)
        items[candidate.id] = speaking
        lastSpokenAt = now
        lastPointId = candidate.point.id
        return ProactiveDecision.Speak(speaking)
    }

    fun complete(utteranceId: String): Boolean = transitionSpeaking(utteranceId, NarrativeStatus.COMPLETED, null)
    fun interrupt(utteranceId: String): Boolean = transitionSpeaking(utteranceId, NarrativeStatus.INTERRUPTED,
        "사용자 발화 또는 오디오 양보. 들린 위치는 알 수 없습니다.")

    /** Invalidates only changed segments/materials; unaffected scripts advance to the new plan revision. */
    fun invalidate(newRevision: Long, affectedSegments: Set<String>, changedMaterialIds: Set<String> = emptySet()): List<String> {
        val invalidated = mutableListOf<String>()
        items.keys.toList().forEach { key ->
            val item = items.getValue(key)
            if (item.status !in setOf(NarrativeStatus.PREPARED, NarrativeStatus.PREPARING, NarrativeStatus.SPEAKING)) return@forEach
            if (item.point.segmentId in affectedSegments || item.point.materialVersions.keys.any { it in changedMaterialIds }) {
                items[key] = item.copy(status = NarrativeStatus.INVALIDATED, statusReason = "경로 구간 또는 원본이 변경되었습니다.")
                invalidated += key
            } else items[key] = item.copy(pathRevision = newRevision)
        }
        preparingPoints.clear()
        return invalidated
    }

    private fun transitionSpeaking(id: String, status: NarrativeStatus, reason: String?): Boolean {
        val current = items[id] ?: return false
        if (current.status != NarrativeStatus.SPEAKING) return false
        items[id] = current.copy(status = status, statusReason = reason)
        return true
    }

    private fun expireAndSkip(context: ProactiveContext, now: Long) {
        items.keys.toList().forEach { key ->
            val item = items.getValue(key)
            if (item.status != NarrativeStatus.PREPARED) return@forEach
            val reason = when {
                now > item.expiresAt -> "설명 유효 시간이 지났습니다."
                item.pathRevision != context.pathRevision -> "경로 버전이 달라졌습니다."
                item.point.materialVersions.any { (id, version) -> context.materialVersions[id] != version } -> "원본 버전이 바뀌었습니다."
                context.routeId != null && item.point.routeId != context.routeId -> "실제 안내 경로가 바뀌었습니다."
                context.segmentId == item.point.segmentId && context.progressMeters != null &&
                    context.progressMeters > item.point.progressMeters + item.point.passedToleranceMeters -> "설명 지점을 지나갔습니다."
                else -> null
            }
            if (reason != null) items[key] = item.copy(status = if (reason == "설명 지점을 지나갔습니다." || now > item.expiresAt)
                NarrativeStatus.SKIPPED else NarrativeStatus.INVALIDATED, statusReason = reason)
        }
    }

    private fun identityError(context: ProactiveContext): String? =
        if (context.accountId != accountId || context.pathId != pathId) "다른 계정 또는 경로입니다." else null

    private fun routeError(context: ProactiveContext, now: Long): String? = when {
        !context.guiding || context.routeId.isNullOrBlank() || context.segmentId.isNullOrBlank() -> "실제 안내 구간을 확인해야 합니다."
        context.routeEvidence != RouteEvidence.VERIFIED_GUIDANCE_SEGMENT -> "실제 안내 도로와의 관계가 확인되지 않았습니다."
        context.location?.isValid != true || context.locationMeasuredAt == null || context.locationMeasuredAt > now ||
            now - context.locationMeasuredAt > maxLocationAgeMillis -> "위치가 오래되었거나 확인되지 않았습니다."
        context.guidanceObservedAt == null || context.guidanceObservedAt > now ||
            now - context.guidanceObservedAt > maxGuidanceAgeMillis -> "안내 상태를 다시 확인해야 합니다."
        context.progressMeters == null || !context.progressMeters.isFinite() -> "안내 구간 진행을 확인해야 합니다."
        else -> null
    }

    private fun eligiblePoint(point: GuidePoint, context: ProactiveContext): Boolean =
        point.routeEvidence == RouteEvidence.VERIFIED_GUIDANCE_SEGMENT && point.routeId == context.routeId &&
            point.segmentId == context.segmentId && point.sources.isNotEmpty() && point.sources.all { it.isIdentifiable } &&
            point.materialVersions.all { (id, version) -> context.materialVersions[id] == version }

    private fun headingMatches(point: GuidePoint, heading: Double?): Boolean {
        val expected = point.expectedHeadingDegrees ?: return false // Direction is required for route-based speech.
        if (heading == null || !heading.isFinite()) return false
        val delta = ((heading - expected) % 360 + 540) % 360 - 180
        return abs(delta) <= point.headingToleranceDegrees
    }
}
