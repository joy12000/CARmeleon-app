package ai.pleos.carmeleon.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class GuidanceIdentityTest {
    @Test fun pollStateAndFreshnessAreNotRouteChanges() {
        val route = ObservedGuidance(GuidanceStatus.GUIDING, listOf(RouteStop("v", "방문", Coordinate(37.5, 127.0))), "r", observedAtMillis = 1)
        assertEquals(route.fingerprint, route.copy(refreshing = true).fingerprint)
        assertEquals(route.fingerprint, route.copy(status = GuidanceStatus.UNKNOWN).fingerprint)
        assertEquals(route.fingerprint, route.copy(observedAtMillis = 2, observationVersion = 2).fingerprint)
        assertNotEquals(route.fingerprint, route.copy(stops = listOf(RouteStop("other", "다른 곳", Coordinate(37.6, 127.0)))).fingerprint)
        assertNotEquals(route.fingerprint, route.copy(status = GuidanceStatus.IDLE).fingerprint)
    }
}
