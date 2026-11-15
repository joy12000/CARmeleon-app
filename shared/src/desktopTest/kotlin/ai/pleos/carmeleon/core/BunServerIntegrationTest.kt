package ai.pleos.carmeleon.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue

/** Only runs with an explicitly marked isolated server; never writes the user's normal store. */
class BunServerIntegrationTest {
    @Test fun kotlinClientRoundTripAgainstIsolatedBunServer() = runBlocking {
        val baseUrl = System.getProperty("carmeleon.integrationBaseUrl") ?: System.getenv("CARMELEON_TEST_BASE_URL")
        val isolated = System.getProperty("carmeleon.integrationIsolated") ?: System.getenv("CARMELEON_TEST_ISOLATED_STORE")
        assumeTrue("Set CARMELEON_TEST_BASE_URL and CARMELEON_TEST_ISOLATED_STORE=true for the isolated fixture.", !baseUrl.isNullOrBlank() && isolated == "true")
        val repository = BunJourneyRepository(HttpUrlConnectionTransport(), baseUrl!!)
        val route = sampleRoute().copy(id = "kotlin-integration-route", title = "Kotlin 통합 확인", origin = DataOrigin.USER)
        val saved = repository.saveRoute(route)
        assertEquals(route.id, saved.id)
        val received = repository.activeRoute()!!
        assertEquals(route.id, received.id)
        assertEquals(route.stops.map { it.coordinate }, received.stops.map { it.coordinate })
        assertEquals(DataOrigin.BACKEND_SAMPLE, received.origin)
        val briefings = repository.briefings(route.id)
        assertEquals(route.stops.size, briefings.size)
        assertTrue(briefings.first().speechText.isNotBlank())
        val guide = repository.guide(Coordinate(37.2886, 127.0128), 0)
        assertTrue(guide.speechText.isNotBlank())
        assertEquals(DataOrigin.BACKEND_SAMPLE, guide.origin)
        val chargers = repository.nearby(PoiKind.CHARGER, Coordinate(37.2886, 127.0128))
        val restrooms = repository.nearby(PoiKind.RESTROOM, Coordinate(37.2886, 127.0128))
        assertTrue(chargers.isNotEmpty() && restrooms.isNotEmpty())
        assertTrue((chargers + restrooms).all { it.stop.coordinate?.isValid == true && it.origin == DataOrigin.BACKEND_SAMPLE })
    }
}
