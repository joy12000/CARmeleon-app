package ai.pleos.carmeleon.agent

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class RouteEvidenceStatus { UNSUPPORTED, WAITING, VERIFIED, PREVIEW, FAILED }

/** Provider-owned road relationship, not a straight line between destination coordinates. */
data class RouteEvidenceSnapshot(
    val status: RouteEvidenceStatus = RouteEvidenceStatus.UNSUPPORTED,
    val routeId: String? = null,
    val segmentId: String? = null,
    val progressMeters: Double? = null,
    val observedAt: Long? = null,
    val points: List<GuidePoint> = emptyList(),
    val sourceName: String = "미연결",
    val drivingWindowSafe: Boolean? = null,
    val message: String = "실제 안내 도로의 통과·진행 정보를 제공하는 연결이 필요합니다.",
)

interface RouteEvidenceProvider {
    val state: StateFlow<RouteEvidenceSnapshot>
    fun close() {}
}

/** Public NaviHelper's routePoints are not full road geometry. This is the honest default. */
class UnsupportedRouteEvidenceProvider : RouteEvidenceProvider {
    override val state: StateFlow<RouteEvidenceSnapshot> = MutableStateFlow(RouteEvidenceSnapshot()).asStateFlow()
}

/** An integration may publish only data actually established by its supported route provider. */
class ObservedRouteEvidenceProvider : RouteEvidenceProvider {
    private val mutable = MutableStateFlow(RouteEvidenceSnapshot(status = RouteEvidenceStatus.WAITING,
        message = "경로 공급자의 확인한 구간을 기다리고 있습니다."))
    override val state = mutable.asStateFlow()
    fun publish(snapshot: RouteEvidenceSnapshot) {
        if (snapshot.status == RouteEvidenceStatus.VERIFIED) {
            require(!snapshot.routeId.isNullOrBlank() && !snapshot.segmentId.isNullOrBlank())
            require(snapshot.progressMeters?.let { it.isFinite() && it >= 0 } == true && snapshot.observedAt != null)
            require(snapshot.sourceName.isNotBlank() && snapshot.sourceName != "미연결")
            require(snapshot.points.all { it.routeId == snapshot.routeId && it.segmentId == snapshot.segmentId &&
                it.routeEvidence == RouteEvidence.VERIFIED_GUIDANCE_SEGMENT })
        }
        mutable.value = snapshot
    }
}

/** Diagnostic fixtures remain PREVIEW and cannot unlock real automatic route narration. */
class PreviewRouteEvidenceProvider(initial: RouteEvidenceSnapshot) : RouteEvidenceProvider {
    private val mutable = MutableStateFlow(initial.copy(status = RouteEvidenceStatus.PREVIEW,
        sourceName = "PREVIEW fixture", message = "모의 경로 입력입니다. 실제 통과 경로로 사용하지 않습니다."))
    override val state = mutable.asStateFlow()
    fun publish(snapshot: RouteEvidenceSnapshot) {
        mutable.value = snapshot.copy(status = RouteEvidenceStatus.PREVIEW, sourceName = "PREVIEW fixture",
            message = "모의 경로 입력입니다. 실제 통과 경로로 사용하지 않습니다.")
    }
}
