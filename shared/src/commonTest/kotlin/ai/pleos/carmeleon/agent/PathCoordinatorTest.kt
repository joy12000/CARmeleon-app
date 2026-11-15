package ai.pleos.carmeleon.agent

import ai.pleos.carmeleon.core.Coordinate
import ai.pleos.carmeleon.core.NavigationRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class PathCoordinatorTest {
    private val start = PathStop("a", "A", Coordinate(37.5, 127.0))
    private val end = PathStop("b", "B", Coordinate(37.6, 127.1))
    private val original = PathDocument("path", "Plan", stops = listOf(end), updatedAt = 1_000, accountId = "alice")
    private val observed = GuidanceSnapshot("oem-1", GuidanceStatus.GUIDING, listOf(end), 1_000, complete = true)
    private fun change(id: String = "change", base: Long = 1) = PathChangeSet(id, "path", base,
        listOf(start, end), "Visit A", 1_000, 30_000, observed.fingerprint, "alice")

    @Test fun voiceAndButtonApproveSameChangeExactlyOnce() {
        val coordinator = PathCoordinator(original)
        coordinator.observe(observed)
        assertIs<PathResult.Saved>(coordinator.propose(change(), 1_100))
        val dispatch = assertIs<PathResult.Dispatch>(coordinator.approve("change", ApprovalSource.VOICE,
            1_200, "request", true))
        assertEquals(2L, coordinator.path.revision)
        assertEquals(ApprovalSource.VOICE, dispatch.change.approval)
        assertIs<PathResult.AlreadyHandled>(coordinator.approve("change", ApprovalSource.BUTTON,
            1_300, "duplicate", true))
        assertEquals(2L, coordinator.path.revision)
    }

    @Test fun manualApplyIsApprovalAndInvalidatesOldAiProposal() {
        val coordinator = PathCoordinator(original)
        coordinator.observe(observed)
        coordinator.propose(change("old"), 1_100)
        assertIs<PathResult.Dispatch>(coordinator.applyManual(listOf(start, end), 1,
            1_200, true, "manual"))
        assertEquals(ChangeStatus.STALE, coordinator.changes.first { it.id == "old" }.status)
        assertEquals(ApprovalSource.MANUAL_APPLY, coordinator.changes.first { it.id == "manual" }.approval)
        assertIs<PathResult.AlreadyHandled>(coordinator.applyManual(listOf(start, end), 1,
            1_300, true, "manual"))
    }

    @Test fun rejectionNeverChangesPlanOrDispatches() {
        val coordinator = PathCoordinator(original)
        coordinator.observe(observed)
        coordinator.propose(change(), 1_100)
        assertIs<PathResult.Saved>(coordinator.reject("change"))
        assertEquals(original, coordinator.path)
        assertEquals(ChangeStatus.REJECTED, coordinator.changes.single().status)
    }

    @Test fun routeSearchCompletionCannotConfirmGuidance() {
        val coordinator = PathCoordinator(original)
        coordinator.observe(observed)
        coordinator.propose(change(), 1_100)
        val dispatch = assertIs<PathResult.Dispatch>(coordinator.approve("change", ApprovalSource.BUTTON,
            1_200, "request", true))
        val search = observed.copy(status = GuidanceStatus.ROUTE_SEARCHED,
            stops = listOf(start, end), observedAt = 1_300)
        assertEquals(ChangeStatus.REQUESTED, coordinator.observe(search, dispatch.request))
        assertEquals(ChangeStatus.APPLIED, coordinator.observe(search.copy(status = GuidanceStatus.GUIDING), dispatch.request))
    }

    @Test fun timeoutIsUnknownAndLaterReadbackCanConfirmWithoutRedispatch() {
        val coordinator = PathCoordinator(original)
        coordinator.observe(observed)
        coordinator.propose(change(), 1_100)
        val dispatch = assertIs<PathResult.Dispatch>(coordinator.approve("change", ApprovalSource.BUTTON,
            1_200, "request", true))
        assertTrue(coordinator.markUnknown("request"))
        assertFalse(coordinator.markUnknown("request"))
        assertEquals(ChangeStatus.APPLIED, coordinator.observe(observed.copy(stops = listOf(start, end),
            observedAt = 2_000), dispatch.request))
        assertEquals(2L, coordinator.path.revision)
    }

    @Test fun externalGuidanceChangeInvalidatesPendingApproval() {
        val coordinator = PathCoordinator(original)
        coordinator.observe(observed)
        coordinator.propose(change(), 1_100)
        coordinator.observe(observed.copy(routeId = "external", observedAt = 1_200))
        assertEquals(ChangeStatus.STALE, coordinator.changes.single().status)
        assertIs<PathResult.AlreadyHandled>(coordinator.approve("change", ApprovalSource.VOICE,
            1_300, "no-write", true))
        assertEquals(original, coordinator.path)
    }

    @Test fun unknownOrStaleGuidanceCannotAuthorizeDrivingWrite() {
        val coordinator = PathCoordinator(original)
        val plain = change().copy(guidanceFingerprint = null, expiresAt = 100_000)
        coordinator.propose(plain, 1_100)
        assertIs<PathResult.Refused>(coordinator.approve("change", ApprovalSource.BUTTON, 1_200, "x", true))
        coordinator.observe(observed)
        assertIs<PathResult.Refused>(coordinator.approve("change", ApprovalSource.BUTTON, 30_000, "y", true))
        assertEquals(original, coordinator.path)
    }

    @Test fun accountAndRevisionGuardsPreserveNewerManualPath() {
        val coordinator = PathCoordinator(original)
        assertFalse(coordinator.acceptRemote(original.copy(accountId = "bob", revision = 100)))
        assertFalse(coordinator.acceptRemote(original.copy(revision = 1)))
        assertTrue(coordinator.acceptRemote(original.copy(revision = 2, stops = listOf(start, end))))
        assertIs<PathResult.Refused>(coordinator.propose(change().copy(guidanceFingerprint = null), 1_100))
        assertEquals(2L, coordinator.path.revision)
    }

    @Test fun sdkSegmentsRetainFullDayPlanWithTwoWaypointsMaximum() {
        val stops = (0..7).map { PathStop("stop-$it", "Stop $it", Coordinate(37.0 + it / 100.0, 127.0)) }
        val path = original.copy(stops = stops)
        val first = assertNotNull(path.navigationSegment("first"))
        assertEquals(2, first.waypoints.size)
        assertEquals("stop-2", first.destination.id)
        val final = assertNotNull(path.navigationSegment("final", 6))
        assertEquals(1, final.waypoints.size)
        assertEquals("stop-7", final.destination.id)
        assertEquals(8, path.stops.size)
    }
}
