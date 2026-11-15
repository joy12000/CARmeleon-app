package ai.pleos.carmeleon.agent

import ai.pleos.carmeleon.core.Coordinate
import ai.pleos.carmeleon.core.DataOrigin
import ai.pleos.carmeleon.core.JourneyRoute
import ai.pleos.carmeleon.core.NavigationRequest
import ai.pleos.carmeleon.core.RouteStop
import ai.pleos.carmeleon.core.TravelMode

/** A day plan. Narrative guide points are deliberately absent from [stops]. */
data class PathDocument(
    val id: String,
    val title: String,
    val mode: TravelMode = TravelMode.TRAVEL,
    val revision: Long = 1,
    val stops: List<PathStop>,
    val updatedAt: Long,
    val accountId: String,
    val departureName: String = "",
    val materialIds: Set<String> = emptySet(),
    val source: DataOrigin = DataOrigin.USER,
) {
    init {
        require(id.isNotBlank() && accountId.isNotBlank())
        require(revision > 0)
        require(stops.map { it.id }.distinct().size == stops.size) { "Duplicate stop IDs" }
    }
    fun asJourneyRoute(): JourneyRoute = JourneyRoute(
        id, title, stops.map { it.asRouteStop() }, origin = source, departureName = departureName,
    )
    /** The full plan is retained; each SDK request contains at most two waypoints. */
    fun navigationSegment(requestId: String, startIndex: Int = 0): NavigationRequest? {
        if (startIndex !in stops.indices) return null
        val segment = stops.drop(startIndex).take(3).map { it.asRouteStop() }
        return NavigationRequest(requestId, segment.last(), segment.dropLast(1))
            .takeIf { it.validationError() == null }
    }
}

data class PathStop(
    val id: String,
    val name: String,
    val coordinate: Coordinate?,
    val address: String = "",
    val poiId: String = "0",
    val purpose: String = "",
    val dwellMinutes: Int = 0,
    val arrivalAt: Long? = null,
    val people: List<String> = emptyList(),
    val materialIds: Set<String> = emptySet(),
    val memo: String = "",
    val appointmentAt: String? = null,
    val timeZone: String? = null,
    val memoryIds: Set<String> = emptySet(),
) {
    init { require(id.isNotBlank() && name.isNotBlank()); require(dwellMinutes >= 0) }
    fun asRouteStop(): RouteStop = RouteStop(id, name, coordinate, address, poiId,
        dwellMinutes = dwellMinutes, memo = memo, purpose = purpose, appointmentAt = appointmentAt,
        timeZone = timeZone, materialIds = materialIds.toList(), memoryIds = memoryIds.toList())
}

fun JourneyRoute.asPathDocument(accountId: String, now: Long, revision: Long = 1,
    mode: TravelMode = TravelMode.TRAVEL): PathDocument = PathDocument(
    id, title, mode, revision, stops.map {
        PathStop(it.id, it.name, it.coordinate, it.address, it.poiId,
            purpose = it.purpose, dwellMinutes = it.dwellMinutes, memo = it.memo,
            appointmentAt = it.appointmentAt, timeZone = it.timeZone,
            materialIds = it.materialIds.toSet(), memoryIds = it.memoryIds.toSet())
    }, now, accountId, departureName, source = origin,
)

enum class GuidanceStatus { UNKNOWN, IDLE, ROUTE_SEARCHED, GUIDING, SIMULATION_GUIDING }

/** Readback is separate from requested state. Search completion does not establish guidance. */
data class GuidanceSnapshot(
    val routeId: String? = null,
    val status: GuidanceStatus = GuidanceStatus.UNKNOWN,
    val stops: List<PathStop> = emptyList(),
    val observedAt: Long,
    val origin: DataOrigin = DataOrigin.PLEOS,
    val currentRouteIndex: Int? = null,
    val complete: Boolean = false,
) {
    val isGuiding: Boolean get() = status == GuidanceStatus.GUIDING || status == GuidanceStatus.SIMULATION_GUIDING
    val fingerprint: String get() = listOf(routeId.orEmpty(), status.name,
        stops.joinToString("|") { "${it.id}:${it.coordinate?.latitude}:${it.coordinate?.longitude}" }).joinToString(";")
    fun isFresh(now: Long, maxAgeMillis: Long = 15_000): Boolean =
        complete && observedAt <= now && now - observedAt <= maxAgeMillis
    fun matches(request: NavigationRequest): Boolean {
        val expected = request.waypoints + request.destination
        return complete && isGuiding && expected.size == stops.size && expected.zip(stops).all { (a, b) ->
            // OEM IDs can differ from app IDs; compare actual readback coordinates and order.
            val aPoint = a.coordinate
            val bPoint = b.coordinate
            aPoint != null && bPoint != null && aPoint.distanceKm(bPoint) <= 0.05
        }
    }
}

enum class ApprovalSource { BUTTON, VOICE, MANUAL_APPLY }
enum class ChangeStatus { PROPOSED, APPROVED, REQUESTED, APPLIED, REJECTED, STALE, UNKNOWN, FAILED }

data class PathChangeSet(
    val id: String,
    val pathId: String,
    val baseRevision: Long,
    val stops: List<PathStop>,
    val reason: String,
    val createdAt: Long,
    val expiresAt: Long,
    val guidanceFingerprint: String?,
    val accountId: String,
    val status: ChangeStatus = ChangeStatus.PROPOSED,
    val approval: ApprovalSource? = null,
    val requestId: String? = null,
    val extraMinutes: Int? = null,
)

sealed interface PathResult {
    data class Saved(val path: PathDocument, val change: PathChangeSet? = null) : PathResult
    data class Dispatch(val path: PathDocument, val change: PathChangeSet, val request: NavigationRequest) : PathResult
    data class Refused(val reason: String) : PathResult
    data class AlreadyHandled(val change: PathChangeSet) : PathResult
}

/** Revision/approval coordinator. Persist [path], [changes], and [guidance] in the account repository. */
class PathCoordinator(initialPath: PathDocument, initialChanges: List<PathChangeSet> = emptyList()) {
    init {
        require(initialChanges.all { it.accountId == initialPath.accountId && it.pathId == initialPath.id })
        require(initialChanges.map { it.id }.distinct().size == initialChanges.size)
    }
    var path: PathDocument = initialPath
        private set
    var guidance: GuidanceSnapshot? = null
        private set
    private val mutableChanges = initialChanges.associateBy { it.id }.toMutableMap()
    val changes: List<PathChangeSet> get() = mutableChanges.values.toList()
    private var writeInFlight: String? = initialChanges.firstOrNull { it.status == ChangeStatus.REQUESTED }?.id

    fun propose(change: PathChangeSet, now: Long): PathResult {
        mutableChanges[change.id]?.let { return PathResult.AlreadyHandled(it) }
        validation(change, now)?.let { return PathResult.Refused(it) }
        mutableChanges[change.id] = change
        return PathResult.Saved(path, change)
    }

    fun reject(changeId: String): PathResult {
        val change = mutableChanges[changeId] ?: return PathResult.Refused("변경안을 찾을 수 없습니다.")
        if (change.status != ChangeStatus.PROPOSED) return PathResult.AlreadyHandled(change)
        val rejected = change.copy(status = ChangeStatus.REJECTED)
        mutableChanges[changeId] = rejected
        return PathResult.Saved(path, rejected)
    }

    /** Both voice and button approval enter this exact path. The LLM cannot grant approval. */
    fun approve(changeId: String, source: ApprovalSource, now: Long, requestId: String,
        dispatchToVehicle: Boolean, startIndex: Int = 0): PathResult {
        val change = mutableChanges[changeId] ?: return PathResult.Refused("변경안을 찾을 수 없습니다.")
        if (change.status != ChangeStatus.PROPOSED) return PathResult.AlreadyHandled(change)
        validation(change, now)?.let {
            mutableChanges[changeId] = change.copy(status = ChangeStatus.STALE)
            return PathResult.Refused(it)
        }
        if (dispatchToVehicle && writeInFlight != null) return PathResult.Refused("이전 경로 적용 결과를 확인하고 있습니다.")
        if (dispatchToVehicle && guidance?.isFresh(now) != true)
            return PathResult.Refused("현재 안내 경로를 먼저 확인해야 합니다.")
        val next = path.copy(revision = path.revision + 1, stops = change.stops, updatedAt = now)
        val request = if (dispatchToVehicle) next.navigationSegment(requestId, startIndex) else null
        if (dispatchToVehicle && request == null) return PathResult.Refused("유효한 실제 장소를 선택해 주세요.")
        path = next
        staleOtherProposals(changeId)
        val approved = change.copy(status = if (request != null) ChangeStatus.REQUESTED else ChangeStatus.APPROVED,
            approval = source, requestId = request?.requestId)
        mutableChanges[changeId] = approved
        return if (request != null) {
            writeInFlight = changeId
            PathResult.Dispatch(path, approved, request)
        } else PathResult.Saved(path, approved)
    }

    /** An explicit manual Apply is approval, so no second dialog is added. */
    fun applyManual(stops: List<PathStop>, expectedRevision: Long, now: Long,
        dispatchToVehicle: Boolean, operationId: String, startIndex: Int = 0): PathResult {
        mutableChanges[operationId]?.let { return PathResult.AlreadyHandled(it) }
        val change = PathChangeSet(operationId, path.id, expectedRevision, stops,
            "사용자 경로 수정", now, now + 60_000, guidance?.fingerprint, path.accountId)
        val result = propose(change, now)
        if (result is PathResult.Refused) return result
        return approve(operationId, ApprovalSource.MANUAL_APPLY, now, operationId,
            dispatchToVehicle, startIndex)
    }

    /** Account sync never silently overwrites a newer manual revision. */
    fun acceptRemote(remote: PathDocument): Boolean {
        if (remote.accountId != path.accountId || remote.id != path.id || remote.revision <= path.revision) return false
        path = remote
        staleOtherProposals(null)
        writeInFlight?.let { id -> mutableChanges[id]?.let { mutableChanges[id] = it.copy(status = ChangeStatus.UNKNOWN) } }
        writeInFlight = null
        return true
    }

    fun observe(snapshot: GuidanceSnapshot, request: NavigationRequest? = null): ChangeStatus? {
        guidance = snapshot
        val change = if (request != null) mutableChanges.values.firstOrNull {
            it.requestId == request.requestId && it.status in setOf(ChangeStatus.REQUESTED, ChangeStatus.UNKNOWN)
        } else writeInFlight?.let(mutableChanges::get)
        if (change != null && request != null && request.requestId == change.requestId && snapshot.matches(request)) {
            mutableChanges[change.id] = change.copy(status = ChangeStatus.APPLIED)
            writeInFlight = null
            return ChangeStatus.APPLIED
        }
        // A snapshot after dispatch may be an intermediate native state. Unknown is honest;
        // do not restore an earlier route or call cancelRoute as an assumed rollback.
        if (change != null && snapshot.complete && snapshot.isGuiding && request != null && !snapshot.matches(request)) {
            mutableChanges[change.id] = change.copy(status = ChangeStatus.UNKNOWN)
            writeInFlight = null
        }
        mutableChanges.replaceAllValues { proposed ->
            if (proposed.status == ChangeStatus.PROPOSED && proposed.guidanceFingerprint != null &&
                proposed.guidanceFingerprint != snapshot.fingerprint) proposed.copy(status = ChangeStatus.STALE) else proposed
        }
        return change?.let { mutableChanges[it.id]?.status }
    }

    /** Timeout is not proof of failure. A later readback may still establish the result. */
    fun markUnknown(requestId: String): Boolean {
        val entry = mutableChanges.entries.firstOrNull { it.value.requestId == requestId } ?: return false
        if (entry.value.status != ChangeStatus.REQUESTED) return false
        mutableChanges[entry.key] = entry.value.copy(status = ChangeStatus.UNKNOWN)
        writeInFlight = null
        return true
    }

    private fun validation(change: PathChangeSet, now: Long): String? = when {
        change.accountId != path.accountId || change.pathId != path.id -> "다른 계정 또는 경로의 변경안입니다."
        change.baseRevision != path.revision -> "경로가 수정되어 변경안을 다시 준비해야 합니다."
        change.expiresAt <= now || change.createdAt > now -> "변경안의 유효 시간이 지났습니다."
        change.stops.isEmpty() || change.stops.any { it.coordinate?.isValid != true } -> "변경할 장소의 위치를 확인해 주세요."
        change.stops.map { it.id }.distinct().size != change.stops.size -> "방문 장소가 중복되었습니다."
        change.guidanceFingerprint != null && change.guidanceFingerprint != guidance?.fingerprint -> "실제 안내 경로가 바뀌었습니다."
        else -> null
    }

    private fun staleOtherProposals(except: String?) {
        mutableChanges.replaceAllValues {
            if (it.id != except && it.status == ChangeStatus.PROPOSED) it.copy(status = ChangeStatus.STALE) else it
        }
    }
}

private inline fun <K, V> MutableMap<K, V>.replaceAllValues(transform: (V) -> V) {
    keys.toList().forEach { key -> get(key)?.let { put(key, transform(it)) } }
}
