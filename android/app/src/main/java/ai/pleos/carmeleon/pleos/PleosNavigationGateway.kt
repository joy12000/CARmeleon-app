package ai.pleos.carmeleon.pleos

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import java.lang.ref.WeakReference
import ai.pleos.carmeleon.core.*
import ai.pleos.playground.navi.constants.NaviMode
import ai.pleos.playground.navi.constants.NavigationStatus
import ai.pleos.playground.navi.data.RouteStateInfo
import ai.pleos.playground.navi.data.CurrentLocationInfo
import ai.pleos.playground.navi.data.WaypointChangedInfo
import ai.pleos.playground.navi.data.NavigationScreenRequest
import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.WaypointIndex
import ai.pleos.playground.navi.data.DestinationArrivedInfo
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.RequestWaypointInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.RouteStartInfo
import ai.pleos.playground.navi.data.RouteWithWaypointsRequest
import ai.pleos.playground.navi.data.WaypointArrivedInfo
import ai.pleos.playground.navi.data.WaypointInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.abs

/** Typed SDK boundary. A method returning is never treated as route success. */
class PleosNavigationGateway(
    context: Context,
    private val requestTimeoutMillis: Long = 25_000,
) : NavigationGateway {
    private val appContext = context.applicationContext
    private val activityRef = WeakReference(context as? Activity)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutableConnection = MutableStateFlow(ServiceConnection(origin = DataOrigin.PLEOS))
    private val mutableEvents = MutableSharedFlow<NavigationEvent>(extraBufferCapacity = 32)
    override val connection = mutableConnection.asStateFlow()
    override val events = mutableEvents.asSharedFlow()
    private val mutableObserved = MutableStateFlow(ObservedGuidance())
    override val observed = mutableObserved.asStateFlow()
    private var lastDestination: RouteStop? = null
    private var lastWaypoints: List<RouteStop> = emptyList()
    private var destinationRead = false
    private var waypointsRead = false
    private var modeRead = false
    private var locationRead = false
    private var observedRouteId: String? = null
    private var observedHeading: Double? = null
    private var mode = GuidanceStatus.UNKNOWN
    private var observationVersion = 0L

    private fun readActual() {
        destinationRead = false; waypointsRead = false; modeRead = false; locationRead = false
        active?.takeIf { !it.confirmed }?.let { it.guidanceActive = false; it.destinationMatched = false; it.waypointsMatched = false }
        mutableObserved.value = mutableObserved.value.copy(refreshing = true)
        runCatching { helper?.getRouteStateInfo(); helper?.getDestinationInfo(); helper?.getWaypointInfo(); helper?.getCurrentLocationInfo() }
    }
    private fun publishObservation() {
        val complete = modeRead && (mode == GuidanceStatus.IDLE || (destinationRead && waypointsRead && locationRead))
        if (!complete) return // Never publish a partly assembled route as a confirmed change.
        mutableObserved.value = mutableObserved.value.copy(
            status = mode, refreshing = false, routeId = if (mode == GuidanceStatus.IDLE) null else observedRouteId,
            headingDegrees = observedHeading,
            stops = if (mode == GuidanceStatus.IDLE) emptyList() else lastWaypoints + listOfNotNull(lastDestination),
            observedAtMillis = System.currentTimeMillis(), observationVersion = ++observationVersion,
        )
    }
    override suspend fun openSearch(keyword: String) = withContext(Dispatchers.Main.immediate) {
        helper?.requestNavigationScreen(NavigationScreenRequest.SearchPlace(keyword)); Unit
    }
    override suspend fun openRouteOptions() = withContext(Dispatchers.Main.immediate) {
        helper?.requestNavigationScreen(NavigationScreenRequest.RouteOptionList); Unit
    }
    override suspend fun openNavigationForeground() = withContext(Dispatchers.Main.immediate) {
        val activity = activityRef.get()?.takeIf { !it.isFinishing && !it.isDestroyed }
        if (activity?.isInMultiWindowMode != true && tryLaunchAdjacentNavigation(activity)) {
            return@withContext
        }
        val instance = helper
        if (instance == null) {
            Log.w("PleosNavigation", "openNavigationForeground skipped: NaviHelper not connected")
            return@withContext
        }
        runCatching {
            instance.requestNavigationScreen(NavigationScreenRequest.Foreground)
            Log.i("PleosNavigation", "Requested NavigationScreenRequest.Foreground")
        }.onFailure { error ->
            Log.w("PleosNavigation", "requestNavigationScreen(Foreground) failed", error)
        }
        Unit
    }
    private fun tryLaunchAdjacentNavigation(activity: Activity?): Boolean {
        val host = activity ?: return false
        val pm = host.packageManager
        val candidates = buildList {
            listOf("ai.pleos.playground.service.navi", "ai.pleos.navi", "com.hyundai.automotive.navi").forEach { pkg ->
                pm.getLaunchIntentForPackage(pkg)?.let(::add)
            }
            add(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_MAPS))
            add(Intent("ai.pleos.navi.action.START_NAVIGATION"))
            add(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0")))
        }
        for (candidate in candidates) {
            val resolved = candidate.resolveActivity(pm) ?: continue
            if (resolved.packageName == host.packageName) continue
            candidate.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT)
            val launched = runCatching {
                host.startActivity(candidate)
                Log.i("PleosNavigation", "Launched navigation adjacent via ${resolved.packageName}/${resolved.className}")
                true
            }.onFailure { error ->
                Log.w("PleosNavigation", "Adjacent launch failed for ${resolved.packageName}", error)
            }.getOrDefault(false)
            if (launched) return true
        }
        Log.w("PleosNavigation", "No adjacent navigation intent resolved; falling back to Foreground SDK request")
        return false
    }
    private var helper: NaviHelper? = null
    private var listener: NaviHelperEventListener? = null
    private var generation = 0L
    @Volatile private var closed = false
    private var timeout: Job? = null
    private var active: Session? = null
    private var observationPoll: Job? = null

    private data class Session(
        val request: NavigationRequest,
        val generation: Long,
        var searchObserved: Boolean = false,
        var routingCompleted: Boolean = false,
        var destinationMatched: Boolean = false,
        var waypointsMatched: Boolean = false,
        var confirmed: Boolean = false,
        var guidanceActive: Boolean = false,
    )

    override suspend fun connect() = withContext(Dispatchers.Main.immediate) {
        if (closed || mutableConnection.value.status == ConnectionStatus.CONNECTED ||
            mutableConnection.value.status == ConnectionStatus.CONNECTING) return@withContext
        newHelper(null)
    }

    override suspend fun request(request: NavigationRequest) = withContext(Dispatchers.Main.immediate) {
        val validation = request.validationError()
        if (validation != null) { emit(NavigationEvent.Failed(request.requestId, validation)); return@withContext }
        if (closed) { emit(NavigationEvent.Failed(request.requestId, "내비게이션 연결이 해제됐습니다.")); return@withContext }
        if (active?.confirmed == false) {
            emit(NavigationEvent.Failed(request.requestId, "이전 경로 요청 결과를 기다리고 있습니다."))
            return@withContext
        }
        // Each request owns one listener generation. Old queued callbacks cannot complete the next request.
        newHelper(request)
    }

    private fun newHelper(request: NavigationRequest?) {
        disposeHelper()
        mutableObserved.value = mutableObserved.value.copy(status = GuidanceStatus.UNKNOWN, refreshing = true)
        val token = ++generation
        val session = request?.let { Session(it, token) }
        active = session
        mutableConnection.value = ServiceConnection(ConnectionStatus.CONNECTING, "Pleos 내비게이션 연결 중", DataOrigin.PLEOS)
        try {
            val instance = NaviHelper(appContext)
            helper = instance
            val callback = createListener(token)
            listener = callback
            if (session != null) startTimeout(session)
            else timeout = scope.launch {
                delay(requestTimeoutMillis)
                if (isCurrent(token) && mutableConnection.value.status == ConnectionStatus.CONNECTING) {
                    ++generation; disposeHelper()
                    mutableConnection.value = ServiceConnection(ConnectionStatus.FAILED, "Pleos 내비 서비스 연결 시간이 초과됐습니다. 연결을 다시 시도해 주세요.", DataOrigin.PLEOS)
                }
            }
            instance.initialize(
                onConnected = {
                    scope.launch {
                        if (!isCurrent(token)) return@launch
                        instance.addListener(callback)
                        if (session == null) timeout?.cancel()
                        mutableConnection.value = ServiceConnection(ConnectionStatus.CONNECTED, "Pleos NaviHelper 연결됨", DataOrigin.PLEOS)
                        readActual()
                        observationPoll?.cancel()
                        observationPoll = scope.launch { while (isCurrent(token)) { delay(10_000); if (isCurrent(token)) readActual() } }
                        if (session != null) sendRoute(instance, session)
                    }
                },
                onFailed = { error -> scope.launch {
                    if (!isCurrent(token)) return@launch
                    mutableConnection.value = ServiceConnection(ConnectionStatus.FAILED, "Pleos 내비 서비스 연결 실패: ${error.message.orEmpty()}", DataOrigin.PLEOS)
                    session?.let { fail(it, "내비 서비스에 연결하지 못했습니다. Pleos 실행 환경과 권한을 확인해 주세요.") }
                } },
            )
        } catch (error: Exception) {
            mutableConnection.value = ServiceConnection(ConnectionStatus.FAILED, "Pleos 내비 초기화 실패: ${error.message.orEmpty()}", DataOrigin.PLEOS)
            session?.let { fail(it, mutableConnection.value.message) }
        }
    }

    private fun sendRoute(instance: NaviHelper, session: Session) {
        if (!isCurrent(session.generation)) return
        try {
            emit(NavigationEvent.Requested(session.request.requestId))
            val destination = session.request.destination.toRouteInfo()
            if (session.request.waypoints.isEmpty()) instance.requestRoute(destination)
            else instance.requestRouteWithWaypoints(RouteWithWaypointsRequest(destination, session.request.waypoints.mapIndexed { i, stop ->
                val coordinate = requireNotNull(stop.coordinate)
                RequestWaypointInfo(
                    latitude = coordinate.latitude,
                    longitude = coordinate.longitude,
                    poiName = stop.name,
                    waypointIndex = if (i == 0) WaypointIndex.FIRST else WaypointIndex.SECOND,
                    poiId = stop.poiId,
                    address = stop.address,
                    poiSubId = "0",
                )
            }))
        } catch (error: Exception) { fail(session, "경로를 요청하지 못했습니다: ${error.message.orEmpty()}") }
    }

    private fun createListener(token: Long) = object : NaviHelperEventListener {
        override fun onNavigationStatus(status: NavigationStatus) { scope.launch {
            if (!isCurrent(token)) return@launch
            mode = when (status) { NavigationStatus.ROUTE_DRIVE -> GuidanceStatus.GUIDING; NavigationStatus.FREE_DRIVE -> GuidanceStatus.IDLE; else -> GuidanceStatus.UNKNOWN }
            if (status == NavigationStatus.ROUTE_DRIVE) readActual() else { modeRead = true; publishObservation() }
        } }
        override fun onRouteStateInfo(routeStateInfo: RouteStateInfo) { scope.launch {
            if (!isCurrent(token)) return@launch
            mode = when (routeStateInfo.naviMode) {
                NaviMode.ROUTE_GUIDING -> GuidanceStatus.GUIDING
                NaviMode.SIMULATION_GUIDING -> GuidanceStatus.SIMULATION
                NaviMode.SAFE_GUIDING -> GuidanceStatus.IDLE
                else -> GuidanceStatus.UNKNOWN
            }
            modeRead = true
            active?.takeIf { it.generation == token }?.let { session ->
                session.guidanceActive = mode == GuidanceStatus.GUIDING || mode == GuidanceStatus.SIMULATION
                maybeComplete(session)
            }
            publishObservation()
        } }
        override fun onCurrentLocationInfo(currentLocationInfo: CurrentLocationInfo) { scope.launch {
            if (!isCurrent(token)) return@launch
            if (!mutableObserved.value.refreshing && mutableObserved.value.status in setOf(GuidanceStatus.GUIDING, GuidanceStatus.SIMULATION) && mutableObserved.value.routeId != currentLocationInfo.routeId) readActual()
            observedRouteId = currentLocationInfo.routeId; observedHeading = currentLocationInfo.heading
            locationRead = true
            publishObservation()
        } }
        override fun onDestinationChanged() { scope.launch { if (isCurrent(token)) readActual() } }
        override fun onWaypointChanged(waypointChangedInfo: WaypointChangedInfo) { scope.launch { if (isCurrent(token)) readActual() } }
        override fun onReRouteEnded() { scope.launch { if (isCurrent(token)) readActual() } }

        override fun onRouteStarted(routeStartInfo: RouteStartInfo) = onMain(token) { session ->
            // This is search-start information, not guidance confirmation.
            session.searchObserved = routeStartInfo.name.trim().equals(session.request.destination.name.trim(), ignoreCase = true)
        }
        override fun onRoutingCompleted() = onMain(token) { session ->
            if (session.confirmed || !session.searchObserved) return@onMain
            session.routingCompleted = true
            // Callbacks have no request ID. Verify the actual destination AND waypoint sequence before committing.
            try { readActual() }
            catch (error: Exception) { fail(session, "반영된 경로를 확인하지 못했습니다: ${error.message.orEmpty()}") }
        }
        override fun onDestinationInfo(destinationInfo: DestinationInfo) { scope.launch {
            if (!isCurrent(token)) return@launch
            lastDestination = RouteStop("observed-destination", destinationInfo.name, Coordinate(destinationInfo.latitude, destinationInfo.longitude), destinationInfo.address, destinationInfo.poiId)
            destinationRead = true; publishObservation()
        }; onMain(token) { session ->
            if (!session.routingCompleted || session.confirmed) return@onMain
            session.destinationMatched = matches(session.request.destination, destinationInfo.latitude, destinationInfo.longitude)
            maybeComplete(session)
        } }
        override fun onWayPointInfo(waypointInfo: List<WaypointInfo>) { scope.launch {
            if (!isCurrent(token)) return@launch
            lastWaypoints = waypointInfo.mapIndexed { index, point -> RouteStop("observed-waypoint-$index", point.name, Coordinate(point.latitude, point.longitude), point.address, point.poiId) }
            waypointsRead = true; publishObservation()
        }; onMain(token) { session ->
            if (!session.routingCompleted || session.confirmed) return@onMain
            session.waypointsMatched = waypointInfo.size == session.request.waypoints.size &&
                session.request.waypoints.zip(waypointInfo).all { (expected, actual) -> matches(expected, actual.latitude, actual.longitude) }
            maybeComplete(session)
        } }
        override fun onError(errorCode: NaviErrorCode) = onMain(token) { session ->
            if (!session.confirmed) fail(session, "Pleos 경로 탐색 오류: ${errorCode.name}")
        }
        override fun onRouteCancelled() { scope.launch {
            if (isCurrent(token)) { mode = GuidanceStatus.IDLE; modeRead = true; lastDestination = null; lastWaypoints = emptyList(); publishObservation() }
        }; onMain(token) { session ->
            timeout?.cancel(); active = null
            emit(NavigationEvent.Cancelled(session.request.requestId))
        } }
        override fun onDestinationArrived(destinationArrivedInfo: DestinationArrivedInfo) = onMain(token) { session ->
            if (session.confirmed) emit(NavigationEvent.DestinationArrived(session.request.requestId))
        }
        override fun onWayPointArrived(waypointArrivedInfo: WaypointArrivedInfo) = onMain(token) { session ->
            if (!session.confirmed) return@onMain
            val index = when (waypointArrivedInfo.index) { WaypointIndex.FIRST -> 0; WaypointIndex.SECOND -> 1; else -> return@onMain }
            emit(NavigationEvent.WaypointArrived(session.request.requestId, index))
        }
    }

    private fun onMain(token: Long, action: (Session) -> Unit) {
        scope.launch { if (isCurrent(token)) active?.takeIf { it.generation == token }?.let(action) }
    }
    private fun isCurrent(token: Long) = !closed && generation == token
    private fun maybeComplete(session: Session) {
        if (!session.confirmed && session.searchObserved && session.routingCompleted && session.guidanceActive && session.destinationMatched && session.waypointsMatched) {
            session.confirmed = true; timeout?.cancel()
            emit(NavigationEvent.Completed(session.request.requestId))
        }
    }
    private fun startTimeout(session: Session) {
        timeout = scope.launch {
            delay(requestTimeoutMillis)
            if (isCurrent(session.generation) && active === session && !session.confirmed) {
                fail(session, "내비게이션 반영 확인 시간이 초과됐습니다. 기존 일정은 보존했습니다. 차량 내비 상태를 확인한 후 다시 시도해 주세요.")
            }
        }
    }
    private fun fail(session: Session, message: String) {
        if (active !== session) return
        timeout?.cancel(); active = null
        emit(NavigationEvent.Failed(session.request.requestId, message))
        // Release listeners, not the previous route. This app must not blindly cancel a user's existing navigation.
        ++generation; disposeHelper()
        mutableObserved.value = mutableObserved.value.copy(status = GuidanceStatus.UNKNOWN, refreshing = true)
        mutableConnection.value = ServiceConnection(ConnectionStatus.FAILED, message, DataOrigin.PLEOS)
    }
    override suspend fun cancel(requestId: String) = withContext(Dispatchers.Main.immediate) {
        val session = active?.takeIf { it.request.requestId == requestId } ?: return@withContext
        // This abandons this app request only. cancelRoute() would cancel the user's entire active navigation.
        timeout?.cancel(); active = null; ++generation; disposeHelper()
        emit(NavigationEvent.Cancelled(session.request.requestId))
        mutableObserved.value = mutableObserved.value.copy(status = GuidanceStatus.UNKNOWN, refreshing = true)
        mutableConnection.value = ServiceConnection(ConnectionStatus.DISCONNECTED, "요청 추적을 중단했습니다. 실제 내비 상태는 다시 확인해야 합니다.", DataOrigin.PLEOS)
        newHelper(null)
    }
    private fun emit(event: NavigationEvent) { mutableEvents.tryEmit(event) }
    private fun disposeHelper() {
        observationPoll?.cancel(); observationPoll = null
        helper?.let { instance ->
            listener?.let { runCatching { instance.removeListener(it) } }
            runCatching { instance.release() }
        }
        helper = null; listener = null
    }
    override fun close() {
        if (closed) return
        closed = true; ++generation; active = null; timeout?.cancel()
        disposeHelper(); scope.cancel()
        mutableConnection.value = ServiceConnection(ConnectionStatus.DISCONNECTED, "내비게이션 연결 해제", DataOrigin.PLEOS)
    }
    private fun RouteStop.toRouteInfo(): RouteInfo {
        val point = requireNotNull(coordinate)
        return RouteInfo(latitude = point.latitude, longitude = point.longitude, poiName = name, poiId = poiId, address = address, poiSubId = "0")
    }
    private fun matches(stop: RouteStop, latitude: Double, longitude: Double): Boolean = stop.coordinate?.let {
        abs(it.latitude - latitude) <= 0.0001 && abs(it.longitude - longitude) <= 0.0001
    } == true
}
