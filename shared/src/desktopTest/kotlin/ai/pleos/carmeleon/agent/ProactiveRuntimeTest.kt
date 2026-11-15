package ai.pleos.carmeleon.agent

import ai.pleos.carmeleon.core.Coordinate
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Local synthetic HTTP fixtures only; these do not claim an actual Pleos/model call. */
class ProactiveRuntimeTest {
    @Test fun unsupportedRoadInputMakesNoServerOrSpeechRequests() = runBlocking {
        withFixture { fixture ->
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val count = AtomicInteger()
            val runtime = ProactiveRuntime(scope, fixture.api, UnsupportedRouteEvidenceProvider(),
                { fixture.context() }, { "fingerprint" }, { count.incrementAndGet(); true })
            try {
                delay(250)
                assertEquals(0, fixture.requests.size)
                assertEquals(0, count.get())
                assertEquals(ProactiveRuntimePhase.HELD, runtime.state.value.phase)
            } finally { runtime.close(); scope.cancel() }
        }
    }

    @Test fun verifiedFixturePreparesOnceAndReportsActualCallbackState() = runBlocking {
        withFixture { fixture ->
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val count = AtomicInteger()
            val provider = fixture.provider()
            val runtime = ProactiveRuntime(scope, fixture.api, provider, { fixture.context() },
                { "fingerprint" }, { count.incrementAndGet(); true })
            try {
                await { count.get() == 1 && fixture.requests.any { it.endsWith("/speech/status") } }
                runtime.completed("speech")
                await { fixture.statuses.contains("COMPLETED") }
                repeat(3) { runtime.refresh() }
                delay(150)
                assertEquals(1, fixture.requests.count { it == "POST /api/v1/narratives/prepare" })
                assertEquals(1, count.get())
                assertTrue(fixture.statuses.contains("SPEAKING"))
            } finally { runtime.close(); scope.cancel() }
        }
    }

    @Test fun restoredCompletedScriptIsNotGeneratedOrSpokenAgain() = runBlocking {
        withFixture(completed = true) { fixture ->
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val count = AtomicInteger()
            val runtime = ProactiveRuntime(scope, fixture.api, fixture.provider(), { fixture.context() },
                { "fingerprint" }, { count.incrementAndGet(); true })
            try {
                await { fixture.requests.any { it.startsWith("GET /api/v1/narratives?") } }
                repeat(3) { runtime.refresh() }
                delay(200)
                assertEquals(0, count.get())
                assertEquals(0, fixture.requests.count { it == "POST /api/v1/narratives/prepare" })
            } finally { runtime.close(); scope.cancel() }
        }
    }

    private suspend fun await(condition: () -> Boolean) {
        val until = System.currentTimeMillis() + 5_000
        while (!condition() && System.currentTimeMillis() < until) delay(20)
        assertTrue(condition(), "Fixture flow did not finish within 5 seconds")
    }

    private suspend fun withFixture(completed: Boolean = false, block: suspend (Fixture) -> Unit) {
        val fixture = Fixture(completed)
        try { block(fixture) } finally { fixture.server.stop(0) }
    }

    private class Fixture(completed: Boolean) {
        val requests = CopyOnWriteArrayList<String>()
        val statuses = CopyOnWriteArrayList<String>()
        val server: HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val api: AgentHttpClient
        private val source = SourceReference(url = "https://example.org/synthetic-fixture", text = "Synthetic test place fact")
        private val point = GuidePoint("point", "place", "Synthetic place", Coordinate(37.5, 127.0),
            "segment", "route", 200.0, RouteEvidence.VERIFIED_GUIDANCE_SEGMENT,
            listOf(source), expectedHeadingDegrees = 90.0)
        init {
            server.createContext("/") { exchange ->
                requests += "${exchange.requestMethod} ${exchange.requestURI}"
                val body = exchange.requestBody.bufferedReader().use { it.readText() }
                val response = when {
                    exchange.requestMethod == "GET" -> buildJsonObject {
                        putJsonArray("plans") { }
                        putJsonArray("utterances") { if (completed) add(utterance("COMPLETED")) }
                    }
                    exchange.requestURI.path.endsWith("/prepare") -> buildJsonObject {
                        putJsonArray("utterances") { add(utterance("PREPARED")) }; put("cacheHit", false)
                    }
                    else -> buildJsonObject {
                        statuses += Json.parseToJsonElement(body).jsonObject["status"]!!.jsonPrimitive.content
                        put("ok", true)
                    }
                }
                val bytes = response.toString().toByteArray(Charsets.UTF_8)
                exchange.responseHeaders.set("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
            server.start()
            api = AgentHttpClient("http://127.0.0.1:${server.address.port}", SessionTokenVault())
        }
        fun context() = ProactiveContext("alice", "path", 1, "route", "segment", Coordinate(37.5, 127.0),
            System.currentTimeMillis(), System.currentTimeMillis(), 0.0, headingDegrees = 90.0,
            speedMetersPerSecond = 10.0, routeEvidence = RouteEvidence.VERIFIED_GUIDANCE_SEGMENT,
            guiding = true, audioAvailable = true, drivingWindowSafe = true)
        fun provider() = ObservedRouteEvidenceProvider().apply {
            publish(RouteEvidenceSnapshot(RouteEvidenceStatus.VERIFIED, "route", "segment", 0.0,
                System.currentTimeMillis(), listOf(point), "Synthetic test route provider", message = "Synthetic fixture"))
        }
        private fun utterance(status: String) = buildJsonObject {
            put("id", "speech"); put("pathId", "path"); put("pathRevision", 1); put("pointId", "point")
            put("routeId", "route"); put("text", "Synthetic fixture speech."); put("status", status)
            put("createdAt", Instant.now().minusSeconds(5).toString()); put("expiresAt", Instant.now().plusSeconds(120).toString())
            putJsonArray("sources") { add(buildJsonObject { put("url", source.url); put("text", source.text) }) }
        }
    }
}
