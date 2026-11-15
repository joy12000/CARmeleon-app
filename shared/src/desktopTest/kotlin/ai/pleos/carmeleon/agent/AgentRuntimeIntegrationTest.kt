package ai.pleos.carmeleon.agent

import ai.pleos.carmeleon.core.ConnectionStatus
import ai.pleos.carmeleon.core.Coordinate
import ai.pleos.carmeleon.core.DataOrigin
import ai.pleos.carmeleon.core.Gear
import ai.pleos.carmeleon.core.JourneyController
import ai.pleos.carmeleon.core.NavigationEvent
import ai.pleos.carmeleon.core.NavigationGateway
import ai.pleos.carmeleon.core.NavigationRequest
import ai.pleos.carmeleon.core.ObservedGuidance
import ai.pleos.carmeleon.core.RouteStop
import ai.pleos.carmeleon.core.ServiceConnection
import ai.pleos.carmeleon.core.SpeechState
import ai.pleos.carmeleon.core.StreamingVoiceGateway
import ai.pleos.carmeleon.core.VehicleGateway
import ai.pleos.carmeleon.core.VehicleSnapshot
import ai.pleos.carmeleon.core.VoiceEvent
import ai.pleos.carmeleon.ui.AgentUiPhase
import java.io.File
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import org.junit.AfterClass
import org.junit.BeforeClass
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Real Bun API + real Kotlin runtime, isolated credentials/database/originals/cache. No model or SDK claim. */
class AgentRuntimeIntegrationTest {
    @Test fun accountPathMemoryMaterialsAndManualEditRoundTrip() = runBlocking {
        withRuntime { f ->
            f.register("roundtrip")
            val pathId = assertNotNull(f.runtime.state.value.activePathId)
            val initial = f.api.request("GET", "/paths/$pathId")
            // Kotlin routes contain visits only; departure is not an invented extra stop.
            assertEquals(1, initial.objects("stops").size)
            assertEquals(f.journey.state.value.route.destination?.id, initial.objects("stops").single().text("id"))

            f.runtime.saveMemory("A사 주차는 지하 2층")
            f.await { !f.runtime.state.value.busy && f.runtime.state.value.memories.singleOrNull()?.text == "A사 주차는 지하 2층" }
            val note = f.runtime.state.value.memories.single()
            f.runtime.updateMemory(note.id, "A사 주차는 지하 3층")
            f.await { !f.runtime.state.value.busy && f.runtime.state.value.memories.singleOrNull()?.text == "A사 주차는 지하 3층" }
            val stored = f.api.request("GET", "/memory?pathId=$pathId").objects("notes").single()
            assertEquals(2L, stored.number("revision"))
            f.runtime.deleteMemory(note.id)
            f.await { !f.runtime.state.value.busy && f.runtime.state.value.memories.isEmpty() }
            assertTrue(f.api.request("GET", "/memory?pathId=$pathId").objects("notes").isEmpty())

            val content = "이번 회의에서는 납기를 먼저 설명합니다. 파일명을 보고 추측한 내용이 아닙니다."
            f.runtime.uploadMaterial("방문 메모.txt", content.toByteArray(Charsets.UTF_8), "text/plain")
            f.await { !f.runtime.state.value.busy && f.runtime.state.value.materials.size == 1 }
            val materialId = f.runtime.state.value.materials.single().id
            var material: JsonObject
            val extractionDeadline = System.currentTimeMillis() + 10_000
            do {
                material = f.api.request("GET", "/materials/$materialId")
                if (material.text("state") == "PROCESSING") delay(30)
            } while (material.text("state") == "PROCESSING" && System.currentTimeMillis() < extractionDeadline)
            assertEquals("READY", material.text("state"))
            val excerpts = f.api.request("GET", "/materials/$materialId/excerpts").objects("excerpts")
            assertEquals(content, excerpts.joinToString("") { it.text("text").orEmpty() })
            assertTrue(excerpts.all { it.number("version") == 1L && it.number("page") > 0 })

            val next = RouteStop("test-visit", "통합시험 방문지", Coordinate(37.61, 127.02),
                purpose = "고객 방문", dwellMinutes = 25,
                appointmentAt = "2026-11-13T14:00:00+09:00", timeZone = "Asia/Seoul",
                materialIds = listOf(materialId))
            f.runtime.editRoute(listOf(next))
            f.await { !f.runtime.state.value.busy && f.journey.state.value.route.stops.singleOrNull()?.id == next.id }
            val saved = f.api.request("GET", "/paths/$pathId")
            assertEquals(2L, saved.number("revision"))
            assertEquals("고객 방문", saved.objects("stops").single().text("purpose"))
            assertEquals("Asia/Seoul", f.journey.state.value.route.stops.single().timeZone)
            assertEquals(listOf(materialId), f.journey.state.value.route.stops.single().materialIds)
            assertTrue(f.navigation.requests.isEmpty(), "Saving a parked plan must not silently start vehicle guidance")
        }
    }

    @Test fun accountSwitchDoesNotReuseOtherAccountsNotesOriginalsOrPathIds() = runBlocking {
        withRuntime { f ->
            f.register("owner-a")
            val aPath = assertNotNull(f.runtime.state.value.activePathId)
            f.runtime.saveMemory("A 계정만의 비공개 기억")
            f.await { !f.runtime.state.value.busy && f.runtime.state.value.memories.size == 1 }
            f.runtime.addMaterial("A 계정 원본", "A 계정만의 원본 내용")
            f.await { !f.runtime.state.value.busy && f.runtime.state.value.materials.size == 1 }
            val aMaterial = f.runtime.state.value.materials.single().id
            f.runtime.logout()
            f.await { !f.runtime.state.value.busy && f.runtime.state.value.accountEmail == null }
            f.register("owner-b")
            assertNotEquals(aPath, f.runtime.state.value.activePathId)
            assertTrue(f.runtime.state.value.memories.isEmpty())
            assertTrue(f.runtime.state.value.materials.isEmpty())
            assertEquals(404, assertFailsWith<AgentHttpException> { f.api.request("GET", "/paths/$aPath") }.status)
            assertEquals(404, assertFailsWith<AgentHttpException> { f.api.request("GET", "/materials/$aMaterial") }.status)
        }
    }

    @Test fun offlineDraftSurvivesRestartAndConflictWithoutOverwritingNewerServerPlan() = runBlocking {
        withRuntime { f ->
            f.register("outbox")
            val pathId = assertNotNull(f.runtime.state.value.activePathId)
            val accountId = f.api.request("GET", "/auth/me")["account"]!!.jsonObject.text("id")!!
            val before = f.api.request("GET", "/paths/$pathId")
            backend.stop()
            try {
                f.runtime.editRoute(listOf(RouteStop("offline-visit", "보존할 오프라인 초안", Coordinate(37.62, 127.03))))
                f.await { !f.runtime.state.value.busy && f.runtime.state.value.notice?.contains("오프라인 초안") == true }
                val key = "draft-$accountId-$pathId"
                val draft = assertNotNull(f.cache.read(key))
                assertEquals(before.number("revision"), draft.number("baseRevision"))
                assertEquals("offline-visit", f.journey.state.value.route.stops.single().id)
                backend.start()
                val remote = f.api.request("PUT", "/paths/$pathId", buildJsonObject {
                    put("baseRevision", before.number("revision")); put("operationId", UUID.randomUUID().toString())
                    put("title", "다른 기기에서 수정"); put("mode", "TRAVEL"); put("stops", before["stops"]!!)
                })
                f.runtime.refreshAccount()
                f.await { !f.runtime.state.value.busy && f.runtime.state.value.phase == AgentUiPhase.ERROR }
                assertTrue(f.runtime.state.value.notice?.contains("초안을 보존") == true)
                assertEquals(draft, f.cache.read(key))
                assertEquals("offline-visit", f.journey.state.value.route.stops.single().id)
                assertEquals(remote, f.api.request("GET", "/paths/$pathId"))
                assertTrue(f.navigation.requests.isEmpty(), "Offline outbox must never replay a vehicle write")
            } finally { if (!backend.alive()) backend.start() }
        }
    }

    @Test fun missingModelConfigurationBecomesUiErrorWithoutFabricatedSpeech() = runBlocking {
        withRuntime { f ->
            f.register("no-model")
            val health = f.api.request("GET", "/health")
            assertEquals(false, health["modelConfigured"]?.jsonPrimitive?.booleanOrNull)
            val pathId = f.runtime.state.value.activePathId!!
            val before = f.api.request("GET", "/paths/$pathId")
            // A second device has saved a newer plan before this driver's next utterance.
            f.api.request("PUT", "/paths/$pathId", buildJsonObject {
                put("baseRevision", before.number("revision")); put("operationId", UUID.randomUUID().toString())
                put("title", "다른 기기에서 바꾼 계획"); put("mode", before.text("mode")); put("stops", before["stops"]!!)
            })
            f.runtime.submit("다음 방문지에 관해 알려줘")
            f.await { f.runtime.state.value.phase == AgentUiPhase.ERROR }
            assertTrue(f.runtime.state.value.notice?.contains("OpenAI") == true)
            assertTrue(f.voice.spoken.isEmpty())
            assertEquals("다른 기기에서 바꾼 계획", f.journey.state.value.route.title)
            assertTrue(f.navigation.requests.isEmpty(), "Reading another device's plan must not auto-apply it to navigation")
            val error = assertFailsWith<AgentHttpException> {
                f.api.turn(buildJsonObject {
                    put("turnId", UUID.randomUUID().toString()); put("sessionId", "contract-test")
                    put("pathId", f.runtime.state.value.activePathId); put("text", "구성 오류 확인")
                }).collect { }
            }
            assertEquals(503, error.status)
            assertEquals("MODEL_NOT_CONFIGURED", error.code)
        }
    }

    @Test fun absentGuidanceAndNullOptionalTextRemainUnknownInsteadOfLiteralNull() = runBlocking {
        withRuntime { f ->
            f.register("optional")
            val pathId = assertNotNull(f.runtime.state.value.activePathId)
            // This real endpoint returns a JSON scalar null before any SDK observation exists.
            assertTrue(f.api.request("GET", "/paths/$pathId/guidance").isEmpty())
            val route = f.journey.state.value.route.stops.single()
            assertNull(route.appointmentAt)
            assertNull(route.timeZone)
            val optional = buildJsonObject { put("appointmentAt", JsonNull); put("purpose", JsonNull) }
            assertNull(optional.text("appointmentAt"))
            assertNull(optional.text("purpose"))
            assertFalse(f.runtime.state.value.notice == "null")
            assertTrue(f.navigation.requests.isEmpty())
        }
    }

    private suspend fun withRuntime(block: suspend (RuntimeFixture) -> Unit) {
        val fixture = RuntimeFixture(backend)
        try { block(fixture) } finally { fixture.close() }
    }

    private class RuntimeFixture(val backend: BunFixture) {
        private val dispatcher = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "carmeleon-contract-ui").apply { isDaemon = true } }.asCoroutineDispatcher()
        private val scope = CoroutineScope(SupervisorJob() + dispatcher)
        val cache = FileAgentLocalStore(Files.createTempDirectory(backend.directory.toPath(), "client-cache-").toFile())
        val api = AgentHttpClient(backend.baseUrl, SessionTokenVault())
        val navigation = ContractNavigation()
        val voice = ContractVoice()
        val journey = JourneyController(scope, navigation, voice = voice, vehicle = ContractVehicle())
        val runtime = AgentRuntime(scope, journey, navigation, voice, api, cache)
        suspend fun register(prefix: String) {
            val email = "$prefix-${UUID.randomUUID()}@carmeleon.test"
            runtime.authenticate(email, "Carmeleon-contract-2026!", true)
            await { !runtime.state.value.busy && runtime.state.value.accountEmail == email &&
                runtime.state.value.activePathId != null && runtime.state.value.connected }
        }
        suspend fun await(predicate: () -> Boolean) {
            val deadline = System.currentTimeMillis() + 15_000
            while (!predicate() && System.currentTimeMillis() < deadline) delay(20)
            assertTrue(predicate(), "Runtime did not reach expected state: ${runtime.state.value}; server=${backend.logTail()}")
        }
        suspend fun close() {
            withContext(dispatcher) { runtime.close(); journey.release(); scope.cancel() }
            dispatcher.close()
        }
    }

    private class ContractNavigation : NavigationGateway {
        override val connection = MutableStateFlow(ServiceConnection(ConnectionStatus.CONNECTED, "합성 차량 포트", DataOrigin.PREVIEW))
        override val observed = MutableStateFlow(ObservedGuidance(origin = DataOrigin.PREVIEW))
        override val events = MutableSharedFlow<NavigationEvent>(extraBufferCapacity = 16)
        val requests = CopyOnWriteArrayList<NavigationRequest>()
        override suspend fun connect() = Unit
        override suspend fun request(request: NavigationRequest) { requests += request }
        override suspend fun cancel(requestId: String) = Unit
        override fun close() = Unit
    }
    private class ContractVoice : StreamingVoiceGateway {
        override val state = MutableStateFlow(SpeechState(available = true, origin = DataOrigin.PREVIEW))
        override val transcripts = MutableSharedFlow<String>()
        override val voiceEvents = MutableSharedFlow<VoiceEvent>(extraBufferCapacity = 16)
        val spoken = CopyOnWriteArrayList<String>()
        override suspend fun listen() { state.value = state.value.copy(listening = true) }
        override suspend fun speak(text: String) { spoken += text }
        override suspend fun speakChunk(turnId: String, text: String, isFinal: Boolean) { spoken += text }
        override fun interruptSpeech() = Unit
        override fun stop() = Unit
        override fun close() = Unit
    }
    private class ContractVehicle : VehicleGateway {
        override val state = MutableStateFlow(VehicleSnapshot(Gear.PARK, audioFocusAllowed = true, origin = DataOrigin.PREVIEW))
        override suspend fun connect() = Unit
        override fun close() = Unit
    }

    private class BunFixture {
        val directory = Files.createTempDirectory("carmeleon-agent-contract-").toFile().canonicalFile
        private val port = ServerSocket(0).use { it.localPort }
        val baseUrl = "http://127.0.0.1:$port"
        private var process: Process? = null
        private val log = File(directory, "server.log")
        private val project = generateSequence(File(System.getProperty("user.dir")).canonicalFile) { it.parentFile }
            .firstOrNull { File(it, "server/agent-server.ts").isFile }
            ?: error("Cannot locate server/agent-server.ts from the Gradle test working directory")
        fun alive() = process?.isAlive == true
        fun start() {
            if (alive()) return
            val explicit = System.getProperty("carmeleon.bunExecutable")
            val homeBinary = File(System.getProperty("user.home"), ".bun/bin/${if (System.getProperty("os.name").startsWith("Windows")) "bun.exe" else "bun"}")
            val binary = explicit ?: homeBinary.takeIf { it.isFile }?.absolutePath ?: "bun"
            val builder = ProcessBuilder(binary, "--no-env-file", "run", "server/agent-server.ts")
                .directory(project).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.appendTo(log))
            builder.environment().apply {
                keys.filter { it.startsWith("CARMELEON_S3_") || it in setOf("OPENAI_API_KEY", "OPENAI_BASE_URL", "CARMELEON_OPENAI_MODEL", "DATABASE_URL") }.toList().forEach { remove(it) }
                put("NODE_ENV", "test"); put("CARMELEON_AGENT_HOST", "127.0.0.1")
                put("CARMELEON_AGENT_PORT", port.toString()); put("CARMELEON_AGENT_DATA_DIR", File(directory, "data").absolutePath)
            }
            process = try { builder.start() } catch (error: Exception) {
                throw AssertionError("Bun is required for the real client/server integration suite. Set -Dcarmeleon.bunExecutable to its executable.", error)
            }
            val deadline = System.currentTimeMillis() + 15_000
            while (System.currentTimeMillis() < deadline) {
                if (!alive()) error("Isolated Bun server exited: ${logTail()}")
                if (healthy()) return
                Thread.sleep(30)
            }
            stop()
            error("Isolated Bun server did not start: ${logTail()}")
        }
        private fun healthy(): Boolean = runCatching {
            val connection = URL("$baseUrl/api/v1/health").openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 250; connection.readTimeout = 500
                connection.responseCode == 200
            } finally { connection.disconnect() }
        }.getOrDefault(false)
        fun stop() {
            process?.let { child ->
                child.destroy()
                if (!child.waitFor(5, TimeUnit.SECONDS)) { child.destroyForcibly(); child.waitFor(5, TimeUnit.SECONDS) }
            }
            process = null
        }
        fun logTail(): String = runCatching { log.readText().takeLast(2_000) }.getOrDefault("No server log")
        fun close() {
            stop()
            // Delete only this explicitly created temporary fixture; never user data/cache junctions.
            val tempRoot = File(System.getProperty("java.io.tmpdir")).canonicalFile.toPath()
            check(directory.toPath().startsWith(tempRoot) && directory.name.startsWith("carmeleon-agent-contract-"))
            directory.deleteRecursively()
        }
    }

    companion object {
        private lateinit var backend: BunFixture
        @BeforeClass @JvmStatic fun startIsolatedBackend() { backend = BunFixture(); backend.start() }
        @AfterClass @JvmStatic fun stopIsolatedBackend() { if (::backend.isInitialized) backend.close() }
    }
}
