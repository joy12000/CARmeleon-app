package ai.pleos.carmeleon.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

@OptIn(ExperimentalCoroutinesApi::class)
class JourneyControllerTest {
    @Test fun proposalIsCommittedOnlyAfterCompletionCallback() = runTest {
        val nav = TestNavigation()
        val controller = JourneyController(backgroundScope, nav)
        runCurrent()
        val original = controller.state.value.route
        controller.propose(PoiKind.MEAL); runCurrent()
        assertEquals(JourneyPhase.PROPOSAL, controller.state.value.phase)
        assertEquals(original, controller.state.value.route)
        controller.approveProposal(); runCurrent()
        val id = nav.requests.single().requestId
        assertEquals(JourneyPhase.REQUESTING, controller.state.value.phase)
        assertEquals(original, controller.state.value.route)
        nav.events.emit(NavigationEvent.Requested(id)); runCurrent()
        assertEquals(original, controller.state.value.route)
        assertEquals(0, nav.foregroundOpenedCount)
        nav.events.emit(NavigationEvent.Completed(id)); runCurrent()
        assertEquals(JourneyPhase.CONFIRMED, controller.state.value.phase)
        assertEquals(2, controller.state.value.route.stops.size)
        assertEquals(13 * 60 + 6, controller.state.value.route.arrivalMinuteOfDay)
        assertTrue(controller.state.value.acceptedDetour)
        assertEquals(0, nav.foregroundOpenedCount)
    }

    @Test fun failedRequestPreservesRouteAndRetryIgnoresOldCallback() = runTest {
        val nav = TestNavigation()
        val controller = JourneyController(backgroundScope, nav)
        runCurrent()
        val oldRoute = controller.state.value.route
        controller.propose(PoiKind.CHARGER); runCurrent(); controller.approveProposal(); runCurrent()
        val first = nav.requests.single().requestId
        nav.events.emit(NavigationEvent.Failed(first, "연결 끊김")); runCurrent()
        assertEquals(oldRoute, controller.state.value.route)
        assertEquals(JourneyPhase.FAILED, controller.state.value.phase)
        controller.retry(); runCurrent()
        val second = nav.requests.last().requestId
        assertNotEquals(first, second)
        nav.events.emit(NavigationEvent.Completed(first)); runCurrent()
        assertEquals(oldRoute, controller.state.value.route)
        assertEquals(second, controller.state.value.pendingRequestId)
        nav.events.emit(NavigationEvent.Completed(second)); runCurrent()
        assertEquals(PoiKind.CHARGER, controller.state.value.route.stops.first().kind)
    }

    @Test fun cancellationAndTimeoutRejectLateSuccess() = runTest {
        val nav = TestNavigation()
        val controller = JourneyController(backgroundScope, nav, requestTimeoutMillis = 100)
        runCurrent()
        val oldRoute = controller.state.value.route
        controller.propose(PoiKind.RESTROOM); runCurrent(); controller.approveProposal(); runCurrent()
        val cancelled = nav.requests.last().requestId
        controller.cancelPending(); runCurrent()
        nav.events.emit(NavigationEvent.Completed(cancelled)); runCurrent()
        assertEquals(oldRoute, controller.state.value.route)
        controller.retry(); runCurrent()
        val timedOut = nav.requests.last().requestId
        advanceTimeBy(101); runCurrent()
        assertEquals(JourneyPhase.FAILED, controller.state.value.phase)
        assertNotNull(controller.state.value.error)
        nav.events.emit(NavigationEvent.Completed(timedOut)); runCurrent()
        assertEquals(oldRoute, controller.state.value.route)
        assertTrue(timedOut in nav.cancelled)
    }

    @Test fun dismissAndReopenNeverUndoOrDuplicateAcceptedDetour() = runTest {
        val nav = TestNavigation()
        val controller = JourneyController(backgroundScope, nav)
        runCurrent()
        controller.propose(PoiKind.MEAL); runCurrent(); controller.approveProposal(); runCurrent()
        nav.events.emit(NavigationEvent.Completed(nav.requests.last().requestId)); runCurrent()
        val accepted = controller.state.value.route
        controller.dismissProposal(); runCurrent()
        assertFalse(controller.state.value.proposalVisible)
        assertEquals(accepted, controller.state.value.route)
        controller.approveProposal(); runCurrent()
        assertEquals(accepted, controller.state.value.route)
        assertEquals(1, nav.requests.size)
    }

    @Test fun dayPlanIsSegmentedWithoutDiscardingLaterStopsAndDuplicateArrivalIsIgnored() = runTest {
        val nav = TestNavigation()
        val stops = (1..5).map { RouteStop("$it", "장소 $it", Coordinate(37.2 + it / 100.0, 127.0)) }
        val route = sampleRoute().copy(stops = stops)
        val controller = JourneyController(backgroundScope, nav, initialRoute = route)
        runCurrent(); controller.start(); runCurrent()
        val first = nav.requests.single()
        assertEquals("3", first.destination.id)
        assertEquals(listOf("1", "2"), first.waypoints.map { it.id })
        nav.events.emit(NavigationEvent.Completed(first.requestId)); runCurrent()
        assertEquals(stops, controller.state.value.route.stops)
        nav.events.emit(NavigationEvent.DestinationArrived(first.requestId)); runCurrent()
        assertEquals(2, nav.requests.size)
        assertEquals("5", nav.requests.last().destination.id)
        assertEquals(listOf("4"), nav.requests.last().waypoints.map { it.id })
        nav.events.emit(NavigationEvent.DestinationArrived(first.requestId)); runCurrent()
        assertEquals(2, nav.requests.size)
        val last = nav.requests.last().requestId
        nav.events.emit(NavigationEvent.Completed(last)); runCurrent()
        nav.events.emit(NavigationEvent.DestinationArrived(last)); runCurrent()
        assertEquals(JourneyPhase.ARRIVED, controller.state.value.phase)
    }

    @Test fun invalidCoordinatesAreNeverSentAndReleasedControllerIgnoresCallbacks() = runTest {
        val nav = TestNavigation()
        val invalid = sampleRoute().copy(stops = listOf(RouteStop("bad", "좌표 없음", null)))
        val controller = JourneyController(backgroundScope, nav, initialRoute = invalid)
        runCurrent(); controller.start(); runCurrent()
        assertTrue(nav.requests.isEmpty())
        assertEquals(JourneyPhase.FAILED, controller.state.value.phase)
        controller.release()
        val stopped = controller.state.value
        controller.onNavigationEvent(NavigationEvent.Completed("route-1")); controller.propose(PoiKind.MEAL); runCurrent()
        assertEquals(stopped, controller.state.value)
        assertTrue(nav.closed)
    }

    @Test fun navigationRequestRejectsExcessWaypointsAndOutOfRangeCoordinate() {
        val stop = sampleRoute().destination!!
        assertNotNull(NavigationRequest("x", stop, listOf(stop, stop, stop)).validationError())
        assertNotNull(NavigationRequest("x", stop.copy(coordinate = Coordinate(91.0, 0.0))).validationError())
        assertEquals(null, NavigationRequest("x", stop, listOf(stop, stop)).validationError())
    }

    @Test fun safetyReasonsDoNotOverwriteEachOther() {
        val snapshot = VehicleSnapshot(gear = Gear.REVERSE, audioFocusAllowed = true, navigationSpeaking = true)
        assertFalse(snapshot.canSpeak)
        assertFalse(snapshot.copy(gear = Gear.DRIVE).canSpeak)
        assertTrue(snapshot.copy(gear = Gear.DRIVE, navigationSpeaking = false).canSpeak)
        assertFalse(snapshot.copy(gear = Gear.UNKNOWN, navigationSpeaking = false).canSpeak)
    }
}

private class TestNavigation : NavigationGateway {
    override val connection = MutableStateFlow(ServiceConnection(ConnectionStatus.CONNECTED, "시연 연결", DataOrigin.PREVIEW))
    override val events = MutableSharedFlow<NavigationEvent>(extraBufferCapacity = 16)
    val requests = mutableListOf<NavigationRequest>()
    val cancelled = mutableListOf<String>()
    var foregroundOpenedCount = 0
    var closed = false
    override suspend fun connect() = Unit
    override suspend fun openNavigationForeground() { foregroundOpenedCount++ }
    override suspend fun request(request: NavigationRequest) { requests += request }
    override suspend fun cancel(requestId: String) { cancelled += requestId }
    override fun close() { closed = true }
}
