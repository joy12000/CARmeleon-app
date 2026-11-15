package ai.pleos.carmeleon.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class BunJourneyRepositoryTest {
    @Test fun decodesBothCoordinateNamesAndKeepsUnknownCoordinateUnknown() = runTest {
        val transport = RecordingTransport("""{"status":"SUCCESS","activeRoute":{"routeId":"r1","title":"준비한 일정","stops":[{"id":"a","name":"첫 장소","lat":37.1,"lng":127.1},{"id":"b","name":"좌표 미확인"}]}}""")
        val route = BunJourneyRepository(transport, "http://127.0.0.1:3001/").activeRoute()!!
        assertEquals(Coordinate(37.1, 127.1), route.stops[0].coordinate)
        assertEquals(null, route.stops[1].coordinate)
        assertFalse(route.isNavigable)
        assertEquals(DataOrigin.BACKEND_SAMPLE, route.origin)
        assertEquals("http://127.0.0.1:3001/api/v1/vehicles/me/active-route", transport.url)
    }

    @Test fun poiDecodeRejectsInvalidPlacesAndNeverClaimsLiveAvailability() = runTest {
        val transport = RecordingTransport("""{"status":"SUCCESS","items":[{"id":"ok","name":"서버 충전 예시","latitude":37.2,"longitude":127.2,"durationMin":5,"detail":"예시"},{"id":"bad","name":"잘못된 좌표","latitude":999,"longitude":127.2}] }""")
        val points = BunJourneyRepository(transport, "http://localhost:3001").nearby(PoiKind.CHARGER, Coordinate(37.0, 127.0))
        assertEquals(1, points.size)
        assertEquals(DataOrigin.BACKEND_SAMPLE, points.single().origin)
        assertTrue(transport.body!!.contains("ev_charger"))
        assertTrue(transport.body!!.contains("37.0"))
    }

    @Test fun serverErrorsAndMalformedRepliesAreNotTurnedIntoSuccess() = runTest {
        val transport = RecordingTransport("not-json")
        val repo = BunJourneyRepository(transport, "http://localhost:3001")
        assertFailsWith<BackendException> { repo.activeRoute() }
        transport.reply = """{"status":"ERROR","message":"실패"}"""
        assertFailsWith<BackendException> { repo.activeRoute() }
        transport.status = 404
        assertFailsWith<BackendException> { repo.activeRoute() }
    }

    @Test fun briefingRouteIsEncodedAndUnsupportedMealApiIsExplicit() = runTest {
        val transport = RecordingTransport("""{"status":"SUCCESS","briefings":[{"stopId":"s","stopName":"고객사","briefingPoints":["예시 안건"],"speechText":"예시 안내"}]}""")
        val repo = BunJourneyRepository(transport, "http://localhost:3001")
        assertEquals(1, repo.briefings("한글/일정").size)
        assertTrue(transport.url.contains("%2F"))
        assertTrue(transport.url.endsWith("/briefings"))
        val error = assertFailsWith<BackendException> { repo.nearby(PoiKind.MEAL, null) }
        assertTrue(error.message!!.contains("식사 장소"))
    }

    @Test fun baseUrlRejectsSecretsAndInvalidSchemes() {
        val transport = RecordingTransport("{}")
        assertFailsWith<IllegalArgumentException> { BunJourneyRepository(transport, "file:///tmp") }
        assertFailsWith<IllegalArgumentException> { BunJourneyRepository(transport, "https://user:password@localhost") }
    }
}

private class RecordingTransport(var reply: String, var status: Int = 200) : BackendTransport {
    var url = ""
    var body: String? = null
    override suspend fun send(method: String, url: String, body: String?): HttpReply {
        this.url = url; this.body = body
        return HttpReply(status, reply)
    }
}
