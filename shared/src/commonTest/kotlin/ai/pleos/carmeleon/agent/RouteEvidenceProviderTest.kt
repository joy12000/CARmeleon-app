package ai.pleos.carmeleon.agent

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class RouteEvidenceProviderTest {
    @Test fun destinationSummaryCannotBePublishedAsVerifiedRoadProgress() {
        val provider = ObservedRouteEvidenceProvider()
        assertFailsWith<IllegalArgumentException> {
            provider.publish(RouteEvidenceSnapshot(status = RouteEvidenceStatus.VERIFIED,
                routeId = "route", segmentId = "segment", observedAt = 1_000, sourceName = "NaviHelper routePoints"))
        }
        assertEquals(RouteEvidenceStatus.WAITING, provider.state.value.status)
    }

    @Test fun previewFixtureCannotSwitchItselfIntoVerifiedMode() {
        val provider = PreviewRouteEvidenceProvider(RouteEvidenceSnapshot(status = RouteEvidenceStatus.VERIFIED))
        provider.publish(RouteEvidenceSnapshot(status = RouteEvidenceStatus.VERIFIED,
            routeId = "fixture", segmentId = "s", progressMeters = 0.0, observedAt = 1_000))
        assertEquals(RouteEvidenceStatus.PREVIEW, provider.state.value.status)
        assertEquals("PREVIEW fixture", provider.state.value.sourceName)
    }
}
