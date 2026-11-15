package ai.pleos.carmeleon.agent

import ai.pleos.carmeleon.core.Coordinate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ProactiveSchedulerTest {
    private val now = 100_000L
    private val source = SourceReference(url = "https://example.org/official-place", accessedAt = now)
    private val context = ProactiveContext("alice", "path", 1, "route", "segment", Coordinate(37.5, 127.0),
        now, now, 0.0, headingDegrees = 90.0, speedMetersPerSecond = 10.0,
        routeEvidence = RouteEvidence.VERIFIED_GUIDANCE_SEGMENT, guiding = true,
        audioAvailable = true, drivingWindowSafe = true)
    private fun point(id: String = "point", at: Double = 250.0) = GuidePoint(id, "place-$id", "Place $id",
        Coordinate(37.5, 127.0), "segment", "route", at, RouteEvidence.VERIFIED_GUIDANCE_SEGMENT,
        listOf(source), expectedHeadingDegrees = 90.0)
    private fun utterance(point: GuidePoint = point(), id: String = "speech") = PreparedUtterance(id,
        "alice", "path", 1, point, "근처에 설명할 장소가 있어요.", listOf(source), now, now + 300_000)

    @Test fun rollingWindowCapsCountAndEtaAndDeduplicatesReservations() {
        val scheduler = ProactiveScheduler("alice", "path")
        val candidates = (0..9).map { point("p-$it", 500.0 + it * 1000) }
        val first = scheduler.preparationWindow(candidates, context, now)
        assertEquals(3, first.candidates.size)
        first.candidates.forEach { assertTrue(scheduler.reservePreparation(it.id)) }
        assertTrue(scheduler.preparationWindow(candidates, context, now).candidates.isEmpty())
        assertFalse(scheduler.reservePreparation(first.candidates.first().id))
        val slow = ProactiveScheduler("alice", "path").preparationWindow(candidates,
            context.copy(speedMetersPerSecond = 1.0), now)
        assertEquals(1, slow.candidates.size)
    }

    @Test fun geometryAndRoadRelationshipUnknownCannotPrepareOrSpeak() {
        val scheduler = ProactiveScheduler("alice", "path")
        val unknown = context.copy(routeEvidence = RouteEvidence.UNKNOWN)
        assertTrue(scheduler.preparationWindow(listOf(point()), unknown, now).candidates.isEmpty())
        assertTrue(scheduler.store(utterance(), context, now))
        assertIs<ProactiveDecision.Hold>(scheduler.evaluate(unknown, now))
        assertIs<ProactiveDecision.Hold>(scheduler.evaluate(context.copy(progressMeters = null), now))
    }

    @Test fun proximityAloneDoesNotSpeakWithoutDirectionAndKnownAudio() {
        val scheduler = ProactiveScheduler("alice", "path")
        scheduler.store(utterance(), context, now)
        assertIs<ProactiveDecision.NothingReady>(scheduler.evaluate(context.copy(headingDegrees = 270.0), now))
        assertIs<ProactiveDecision.Hold>(scheduler.evaluate(context.copy(audioAvailable = null), now))
        assertIs<ProactiveDecision.Hold>(scheduler.evaluate(context.copy(drivingWindowSafe = null), now))
        assertIs<ProactiveDecision.Speak>(scheduler.evaluate(context, now))
    }

    @Test fun missedWindowIsSkippedInsteadOfReadAfterAudioBecomesFree() {
        val scheduler = ProactiveScheduler("alice", "path")
        scheduler.store(utterance(), context, now)
        assertIs<ProactiveDecision.Hold>(scheduler.evaluate(context.copy(conversationActive = true), now))
        assertIs<ProactiveDecision.NothingReady>(scheduler.evaluate(context.copy(progressMeters = 500.0), now))
        assertEquals(NarrativeStatus.SKIPPED, scheduler.snapshot.utterances.single().status)
        assertTrue(scheduler.preparationWindow(listOf(point()), context, now).candidates.isEmpty())
    }

    @Test fun reconnectRetainsCompletionAndDoesNotPrepareOrSpeakSameStory() {
        val scheduler = ProactiveScheduler("alice", "path")
        scheduler.store(utterance(), context, now)
        val spoken = assertIs<ProactiveDecision.Speak>(scheduler.evaluate(context, now))
        assertTrue(scheduler.complete(spoken.utterance.id))
        val restored = ProactiveScheduler("alice", "path", scheduler.snapshot)
        assertTrue(restored.preparationWindow(listOf(point()), context, now).candidates.isEmpty())
        assertIs<ProactiveDecision.Hold>(restored.evaluate(context, now)) // cooldown also persists
        assertEquals("place-point", restored.lastReferencedPoint?.placeId)
    }

    @Test fun reconnectDuringPlaybackMarksUnknownInterruptedWithoutAutomaticReplay() {
        val scheduler = ProactiveScheduler("alice", "path")
        scheduler.store(utterance(), context, now)
        scheduler.evaluate(context, now)
        val restored = ProactiveScheduler("alice", "path", scheduler.snapshot)
        assertEquals(NarrativeStatus.INTERRUPTED, restored.snapshot.utterances.single().status)
        assertTrue(restored.preparationWindow(listOf(point()), context, now).candidates.isEmpty())
    }

    @Test fun invalidationPreservesUnaffectedSegmentsAndChangesOnlyTheirRevision() {
        val scheduler = ProactiveScheduler("alice", "path")
        scheduler.store(utterance(), context, now)
        val otherContext = context.copy(segmentId = "other")
        scheduler.store(utterance(point("other").copy(segmentId = "other"), "speech-other"), otherContext, now)
        assertEquals(listOf("speech"), scheduler.invalidate(2, setOf("segment")))
        val unaffected = scheduler.snapshot.utterances.first { it.id == "speech-other" }
        assertEquals(NarrativeStatus.PREPARED, unaffected.status)
        assertEquals(2L, unaffected.pathRevision)
        assertEquals(NarrativeStatus.INVALIDATED, scheduler.snapshot.utterances.first { it.id == "speech" }.status)
    }

    @Test fun changedSourceInvalidatesOldScriptAndAccountCannotCrossCacheScope() {
        val scheduler = ProactiveScheduler("alice", "path")
        val withFile = point().copy(materialVersions = mapOf("file" to 1L))
        assertTrue(scheduler.store(utterance(withFile), context.copy(materialVersions = mapOf("file" to 1L)), now))
        scheduler.evaluate(context.copy(materialVersions = mapOf("file" to 2L)), now)
        assertEquals(NarrativeStatus.INVALIDATED, scheduler.snapshot.utterances.single().status)
        assertFalse(scheduler.store(utterance(id = "bob").copy(accountId = "bob"), context, now))
        assertTrue(scheduler.preparationWindow(listOf(point()), context.copy(accountId = "bob"), now).candidates.isEmpty())
    }

    @Test fun missingSourcesAndOldGpsCannotBeTreatedAsPreparedOrReady() {
        val scheduler = ProactiveScheduler("alice", "path")
        assertFalse(scheduler.store(utterance().copy(sources = emptyList()), context, now))
        assertTrue(scheduler.store(utterance(), context, now))
        assertIs<ProactiveDecision.Hold>(scheduler.evaluate(context.copy(locationMeasuredAt = now - 20_000), now))
        assertEquals(NarrativeStatus.PREPARED, scheduler.snapshot.utterances.single().status)
    }
}
