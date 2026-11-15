package ai.pleos.carmeleon.core

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

enum class TravelMode { TRAVEL, BUSINESS, DAILY }
enum class PoiKind { MEAL, CHARGER, RESTROOM }
enum class DataOrigin { PREVIEW, PLEOS, BACKEND_SAMPLE, USER }
enum class ConnectionStatus { DISCONNECTED, CONNECTING, CONNECTED, UNSUPPORTED, FAILED }
enum class JourneyPhase { READY, DRIVING, PROPOSAL, REQUESTING, CONFIRMED, FAILED, ARRIVED }

data class Coordinate(val latitude: Double, val longitude: Double) {
    val isValid: Boolean get() = latitude.isFinite() && longitude.isFinite() && latitude in -90.0..90.0 && longitude in -180.0..180.0
    fun distanceKm(other: Coordinate): Double {
        val rad = kotlin.math.PI / 180.0
        val a = sin((other.latitude - latitude) * rad / 2).let { it * it } +
            cos(latitude * rad) * cos(other.latitude * rad) * sin((other.longitude - longitude) * rad / 2).let { it * it }
        return 6371.0 * 2 * atan2(sqrt(a.coerceIn(0.0, 1.0)), sqrt((1 - a).coerceIn(0.0, 1.0)))
    }
}

data class RouteStop(
    val id: String,
    val name: String,
    val coordinate: Coordinate?,
    val address: String = "",
    val poiId: String = "0",
    val kind: PoiKind? = null,
    val dwellMinutes: Int = 0,
    val memo: String = "",
    val purpose: String = "",
    val appointmentAt: String? = null,
    val timeZone: String? = null,
    val materialIds: List<String> = emptyList(),
    val memoryIds: List<String> = emptyList(),
)

/** Stops are destinations still belonging to the day plan, not the departure point. */
data class JourneyRoute(
    val id: String,
    val title: String,
    val stops: List<RouteStop>,
    val arrivalMinuteOfDay: Int = 12 * 60 + 20,
    val durationMinutes: Int = 38,
    val distanceKm: Double = 24.0,
    val origin: DataOrigin = DataOrigin.PREVIEW,
    val departureName: String = "판교",
) {
    val destination: RouteStop? get() = stops.lastOrNull()
    val isNavigable: Boolean get() = stops.isNotEmpty() && stops.all { it.name.isNotBlank() && it.coordinate?.isValid == true }
}

data class RouteProposal(
    val stop: RouteStop,
    val kind: PoiKind,
    val extraDrivingMinutes: Int,
    val dwellMinutes: Int,
    val arrivalMinuteOfDay: Int,
    val origin: DataOrigin,
    val reason: String,
    val detail: String = "",
    val estimatesOnly: Boolean = true,
)

data class ServiceConnection(
    val status: ConnectionStatus = ConnectionStatus.DISCONNECTED,
    val message: String = "연결 전",
    val origin: DataOrigin = DataOrigin.PREVIEW,
)

data class NavigationRequest(val requestId: String, val destination: RouteStop, val waypoints: List<RouteStop> = emptyList()) {
    fun validationError(): String? = when {
        requestId.isBlank() -> "경로 요청 ID가 비어 있습니다."
        waypoints.size > 2 -> "Pleos 경유지는 한 번에 최대 두 곳까지 요청할 수 있습니다."
        (waypoints + destination).any { it.name.isBlank() || it.coordinate?.isValid != true } -> "장소 이름과 유효한 위도·경도를 확인해 주세요."
        else -> null
    }
}

sealed interface NavigationEvent {
    val requestId: String
    data class Requested(override val requestId: String) : NavigationEvent
    data class Completed(override val requestId: String) : NavigationEvent
    data class Failed(override val requestId: String, val message: String) : NavigationEvent
    data class Cancelled(override val requestId: String) : NavigationEvent
    data class DestinationArrived(override val requestId: String) : NavigationEvent
    data class WaypointArrived(override val requestId: String, val stopIndex: Int) : NavigationEvent
}

data class LocationFix(val coordinate: Coordinate, val speedKph: Double? = null, val origin: DataOrigin, val measuredAtMillis: Long? = null)
enum class Gear { UNKNOWN, PARK, DRIVE, REVERSE, NEUTRAL }
data class VehicleSnapshot(
    val gear: Gear = Gear.UNKNOWN,
    val audioFocusAllowed: Boolean? = null,
    val navigationSpeaking: Boolean = false,
    val driverAlert: Boolean = false,
    val batteryPercent: Int? = null,
    val origin: DataOrigin = DataOrigin.PLEOS,
) {
    val canSpeak: Boolean get() = gear != Gear.UNKNOWN && gear != Gear.REVERSE && audioFocusAllowed == true && !navigationSpeaking && !driverAlert
    val speechHoldReason: String? get() = when {
        gear == Gear.REVERSE -> "후진 중에는 안내를 잠시 멈춥니다."
        navigationSpeaking -> "내비게이션 안내가 끝나면 이어갈게요."
        driverAlert -> "운전 집중이 필요한 상태라 안내를 보류합니다."
        gear == Gear.UNKNOWN || audioFocusAllowed == null -> "차량 상태를 확인한 뒤 음성 안내를 시작합니다."
        audioFocusAllowed != true -> "다른 소리가 재생 중이라 안내를 보류합니다."
        else -> null
    }
}

data class SpeechState(val available: Boolean = false, val listening: Boolean = false, val speaking: Boolean = false, val message: String = "음성 연결 전", val origin: DataOrigin = DataOrigin.PREVIEW)
data class Briefing(val stopId: String, val stopName: String, val points: List<String>, val speechText: String, val origin: DataOrigin = DataOrigin.BACKEND_SAMPLE)
data class GuideContent(val title: String, val speechText: String, val origin: DataOrigin = DataOrigin.BACKEND_SAMPLE)
data class PoiCandidate(val stop: RouteStop, val durationMinutes: Int?, val distanceKm: Double?, val detail: String, val origin: DataOrigin = DataOrigin.BACKEND_SAMPLE)
data class BackendState(val loading: Boolean = false, val connected: Boolean = false, val message: String = "서버 연결 전", val baseUrl: String = "", val origin: DataOrigin? = null)

data class JourneyState(
    val mode: TravelMode = TravelMode.TRAVEL,
    val route: JourneyRoute = sampleRoute(),
    val proposal: RouteProposal? = null,
    val proposalVisible: Boolean = false,
    val phase: JourneyPhase = JourneyPhase.READY,
    val connection: ServiceConnection = ServiceConnection(),
    val message: String = "준비되면 함께 출발해요.",
    val error: String? = null,
    val pendingRequestId: String? = null,
    val location: LocationFix? = null,
    val vehicle: VehicleSnapshot = VehicleSnapshot(),
    val speech: SpeechState = SpeechState(),
    val backend: BackendState = BackendState(),
    val briefings: List<Briefing> = emptyList(),
    val guide: GuideContent? = null,
    val currentStopIndex: Int = 0,
    val lastTranscript: String? = null,
    val busyFinding: Boolean = false,
    val acceptedDetour: Boolean = false,
) {
    val isPending: Boolean get() = pendingRequestId != null
}

fun sampleRoute(): JourneyRoute = JourneyRoute("preview-suwon", "수원 성곽길 여행", listOf(RouteStop("hwaseong", "수원화성", Coordinate(37.2886, 127.0128), "경기 수원시 장안구 영화동")))
fun formatClock(minutes: Int): String {
    val normalized = ((minutes % 1440) + 1440) % 1440
    return "${(normalized / 60).toString().padStart(2, '0')}:${(normalized % 60).toString().padStart(2, '0')}"
}


enum class GuidanceStatus { UNKNOWN, ROUTING, GUIDING, SIMULATION, IDLE }
/** Independent SDK reads, not an atomic snapshot. Last known stops survive an UNKNOWN state. */
data class ObservedGuidance(
    val status: GuidanceStatus = GuidanceStatus.UNKNOWN,
    val stops: List<RouteStop> = emptyList(),
    val routeId: String? = null,
    val headingDegrees: Double? = null,
    val observedAtMillis: Long? = null,
    val observationVersion: Long = 0,
    val refreshing: Boolean = false,
    val origin: DataOrigin = DataOrigin.PLEOS,
) {
    val fingerprint: String get() = listOf(if (status == GuidanceStatus.IDLE) "no-route" else routeId.orEmpty(),
        (if (status == GuidanceStatus.IDLE) emptyList() else stops).joinToString("|") { "${it.coordinate?.latitude},${it.coordinate?.longitude}" }).joinToString(":")
}
