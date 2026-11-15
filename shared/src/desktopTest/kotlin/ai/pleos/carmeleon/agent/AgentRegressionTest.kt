package ai.pleos.carmeleon.agent

import ai.pleos.carmeleon.core.*
import ai.pleos.carmeleon.core.GuidanceStatus as ObservedStatus
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.time.Instant
import java.util.concurrent.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import kotlin.test.*

/** Deterministic regressions for reviewed user flows. No actual SDK or model is called. */
@OptIn(ExperimentalCoroutinesApi::class)
class AgentRegressionTest {
    @Test fun refreshKeepsPassedStopAndArrivalOwner() = runTest {
        val nav=Nav()
        val route=JourneyRoute("p","경로",listOf(stop("a"),stop("b"),stop("c")))
        val journey=JourneyController(backgroundScope,nav,initialRoute=route)
        runCurrent();journey.start();runCurrent()
        val request=nav.requests.single()
        nav.events.emit(NavigationEvent.Completed(request.requestId));runCurrent()
        nav.events.emit(NavigationEvent.WaypointArrived(request.requestId,0));runCurrent()
        assertEquals(1,journey.state.value.currentStopIndex)
        journey.applyAgentRoute(route)
        nav.events.emit(NavigationEvent.DestinationArrived(request.requestId));runCurrent()
        assertEquals(3,journey.state.value.currentStopIndex)
        assertEquals(JourneyPhase.ARRIVED,journey.state.value.phase)
        journey.start();runCurrent()
        assertEquals(1,nav.requests.size, "Refreshing a plan must preserve guidance ownership and not revisit completed stops")
        journey.release()
    }
    @Test fun droppedTextNeverBecomesCompletedPlayback() = runBlocking {
        withRuntime(Gear.REVERSE) { f ->
            f.runtime.submit("검토")
            f.waitUntil { f.runtime.session.state.value.response.contains("첫 문장") }
            assertTrue(f.voice.spoken.isEmpty())
            f.vehicle.state.value=f.vehicle.state.value.copy(gear=Gear.PARK)
            f.waitUntil { f.journey.state.value.vehicle.gear==Gear.PARK }
            f.release.countDown()
            f.waitUntil { f.voice.spoken.isNotEmpty() }
            f.waitUntil { f.runtime.session.state.value.response.contains("마지막 문장") }
            f.voice.voiceEvents.emit(VoiceEvent.PlaybackDone(f.voice.turn!!))
            f.waitUntil { f.runtime.session.state.value.playback.isNotEmpty() }
            assertEquals("마지막 문장입니다.",f.voice.spoken.joinToString(""))
            val completed=f.runtime.session.state.value.playback.last()
            assertEquals(PlaybackEvidence.COMPLETED_CALLBACK,completed.evidence)
            assertEquals("마지막 문장입니다.",completed.text)
            f.waitUntil { f.playbackReports.any { it["chunkId"]?.jsonPrimitive?.content == "chunk-last" && it["status"]?.jsonPrimitive?.content == "COMPLETED" } }
            assertFalse(f.playbackReports.any { it["chunkId"]?.jsonPrimitive?.content == "chunk-first" && it["status"]?.jsonPrimitive?.content == "COMPLETED" })
        }
    }
    @Test fun firstSentenceStartsImmediatelyAndNextSentenceWaitsForItsOwnCallback() = runBlocking {
        withRuntime(Gear.PARK) { f ->
            f.runtime.submit("검토")
            f.waitUntil { f.runtime.session.state.value.response.contains("첫 문장") }
            delay(250)
            assertEquals(listOf("첫 문장입니다."),f.voice.spoken.toList())
            f.release.countDown()
            // The next sentence must wait for this sentence's own completion, not overlap.
            delay(100); assertEquals(1,f.voice.spoken.size)
            f.voice.voiceEvents.emit(VoiceEvent.PlaybackDone(f.voice.turn!!))
            f.waitUntil { f.voice.spoken.size==2 }
        }
    }
    @Test fun interruptionDropsOldQueueAndLateCompletionCannotAcknowledgeTheNewTurn() = runBlocking {
        withRuntime(Gear.PARK) { f ->
            f.release.countDown()
            f.runtime.submit("첫 요청")
            f.waitUntil { f.voice.spoken.size == 1 && f.turns.size == 1 }
            val oldPlayback=f.voice.turn!!
            val oldTurn=f.runtime.session.state.value.turnId
            f.runtime.submit("새 요청")
            f.waitUntil { f.turns.size == 2 && f.runtime.session.state.value.queuedChunks > 0 }
            assertTrue(f.runtime.session.state.value.awaitingStop)
            f.voice.voiceEvents.emit(VoiceEvent.PlaybackDone(oldPlayback))
            delay(100)
            assertEquals(1,f.voice.spoken.size)
            assertTrue(f.runtime.session.state.value.playback.none { it.turnId == oldTurn && it.evidence == PlaybackEvidence.COMPLETED_CALLBACK })
            f.voice.voiceEvents.emit(VoiceEvent.PlaybackStopped(oldPlayback))
            f.waitUntil { f.voice.spoken.size == 2 }
            assertNotEquals(oldPlayback,f.voice.turn)
            assertFalse(f.runtime.session.state.value.awaitingStop)
        }
    }

    @Test fun sessionsSwitchWithPathAndRestoreWhenReturningToTheSamePath() = runBlocking {
        withRuntime(Gear.PARK) { f ->
            f.release.countDown()
            f.runtime.submit("첫 경로")
            f.waitUntil { f.turns.size == 1 }
            val first=f.turns[0]["sessionId"]
            f.runtime.selectPath("second")
            f.waitUntil { f.runtime.state.value.activePathId=="second" && !f.runtime.state.value.busy }
            f.runtime.submit("둘째 경로")
            f.waitUntil { f.turns.size==2 }
            assertNotEquals(first,f.turns[1]["sessionId"])
            f.runtime.selectPath("p")
            f.waitUntil { f.runtime.state.value.activePathId=="p" && !f.runtime.state.value.busy }
            f.runtime.submit("다시 첫 경로")
            f.waitUntil { f.turns.size==3 }
            assertEquals(first,f.turns[2]["sessionId"])
        }
    }

    @Test fun approvedChangesSkipPassedStopsAndReadOnlyRefreshKeepsThePendingRequest() = runTest {
        val nav=Nav(); val route=JourneyRoute("p","경로",listOf(stop("a"),stop("b"),stop("c")))
        val journey=JourneyController(backgroundScope,nav,initialRoute=route)
        runCurrent();journey.start();runCurrent()
        val first=nav.requests.single()
        nav.events.emit(NavigationEvent.Completed(first.requestId));runCurrent()
        nav.events.emit(NavigationEvent.WaypointArrived(first.requestId,0));runCurrent()
        val changed=route.copy(stops=listOf(stop("a"),stop("d"),stop("b"),stop("c")))
        val requestId=journey.applyAgentRoute(changed,true)
        runCurrent()
        assertEquals(listOf("d","b"),nav.requests.last().waypoints.map{it.id})
        journey.applyAgentRoute(changed.copy(title="서버에서 새로 읽은 제목"))
        assertEquals(requestId,journey.state.value.pendingRequestId)
        nav.events.emit(NavigationEvent.Completed(requestId!!));runCurrent()
        assertEquals("서버에서 새로 읽은 제목",journey.state.value.route.title)
        assertEquals(JourneyPhase.DRIVING,journey.state.value.phase)
        journey.release()
    }

    private suspend fun withRuntime(gear:Gear, action:suspend (Fixture)->Unit) {
        val f=Fixture(gear)
        try { f.runtime.authenticate("review@example.test","review-password-2026",false);f.waitUntil { f.runtime.state.value.activePathId!=null && !f.runtime.state.value.busy };action(f) }
        finally{f.release.countDown();f.runtime.close();f.journey.release();f.scope.cancel();f.dispatcher.close();f.server.stop(0);f.executor.shutdownNow()}
    }
    private class Fixture(gear:Gear) {
        val executor=Executors.newCachedThreadPool()
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        val release=CountDownLatch(1)
        val dispatcher=Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val scope=CoroutineScope(SupervisorJob()+dispatcher)
        val nav=Nav();val voice=Voice();val vehicle=Vehicle(gear)
        val journey=JourneyController(scope,nav,voice=voice,vehicle=vehicle)
        val path=buildJsonObject { put("id","p");put("accountId","a");put("title","경로");put("mode","TRAVEL");put("revision",1);put("updatedAt",Instant.now().toString());putJsonArray("stops"){add(buildJsonObject{put("id","visit");put("name","방문");putJsonObject("coordinate"){put("latitude",37.5);put("longitude",127)}})} }
        val playbackReports=CopyOnWriteArrayList<JsonObject>()
        val turns=CopyOnWriteArrayList<JsonObject>()
        val runtime:AgentRuntime
        init {
            server.executor=executor
            server.createContext("/") { exchange ->
                val endpoint=exchange.requestURI.path.removePrefix("/api/v1")
                val requestText=exchange.requestBody.use { it.readBytes().toString(Charsets.UTF_8) }
                if(endpoint=="/playback") playbackReports += Json.parseToJsonElement(requestText).jsonObject
                if(endpoint=="/turns") {
                    // Parse turnId from the request again is impossible: capture before close.
                    error("Installed separately")
                }
                val response=when(endpoint){
                    "/auth/login"->"""{"accessToken":"review","account":{"id":"a","email":"review@example.test"}}"""
                    "/auth/me"->"""{"account":{"id":"a","email":"review@example.test"},"deviceId":"d"}"""
                    "/paths/p"->path.toString()
                    "/paths/second"->JsonObject(path + ("id" to JsonPrimitive("second"))).toString()
                    "/paths"->"{\"paths\":[$path]}"
                    "/memory"->"""{"notes":[]}"""
                    "/materials"->"""{"materials":[]}"""
                    "/paths/p/proposals","/paths/second/proposals"->"""{"proposals":[]}"""
                    "/actions"->"""{"actions":[]}"""
                    else->"{}"
                }
                val bytes=response.toByteArray(Charsets.UTF_8);exchange.responseHeaders.set("Content-Type","application/json");exchange.sendResponseHeaders(200,bytes.size.toLong());exchange.responseBody.use{it.write(bytes)}
            }
            server.createContext("/api/v1/turns") { exchange ->
                val body=exchange.requestBody.use{it.readBytes().toString(Charsets.UTF_8)}
                if(exchange.requestURI.path.endsWith("/cancel")){exchange.sendResponseHeaders(200,2);exchange.responseBody.use{it.write("{}".toByteArray())};return@createContext}
                val request=Json.parseToJsonElement(body).jsonObject
                turns += request
                val turn=request["turnId"]!!.jsonPrimitive.content
                exchange.responseHeaders.set("Content-Type","text/event-stream");exchange.sendResponseHeaders(200,0)
                exchange.responseBody.use { out ->
                    fun event(n:Long,name:String,text:String="",final:Boolean=false){
                        val data=buildJsonObject{put("turnId",turn);put("sequence",n);put("text",text);put("isFinal",final);put("chunkId",if(n==1L)"chunk-first" else "chunk-last")}
                        out.write("event: $name\ndata: $data\n\n".toByteArray(Charsets.UTF_8));out.flush()
                    }
                    event(1,"assistant.speech_chunk","첫 문장입니다.")
                    check(release.await(8,TimeUnit.SECONDS))
                    event(2,"assistant.speech_chunk","마지막 문장입니다.",true)
                    event(3,"turn.completed")
                }
            }
            server.start()
            runtime=AgentRuntime(scope,journey,nav,voice,AgentHttpClient("http://127.0.0.1:${server.address.port}",SessionTokenVault()))
        }
        suspend fun waitUntil(block:()->Boolean){withTimeout(8000){while(!block())delay(10)}}
    }
    private class Nav:NavigationGateway {
        override val connection=MutableStateFlow(ServiceConnection(ConnectionStatus.CONNECTED,origin=DataOrigin.PLEOS))
        override val events=MutableSharedFlow<NavigationEvent>(extraBufferCapacity=32)
        val requests=CopyOnWriteArrayList<NavigationRequest>()
        override suspend fun connect()=Unit
        override suspend fun request(request:NavigationRequest){requests+=request}
        override suspend fun cancel(requestId:String)=Unit
        override fun close()=Unit
    }
    private class Vehicle(gear:Gear):VehicleGateway {
        override val state=MutableStateFlow(VehicleSnapshot(gear=gear,audioFocusAllowed=true,origin=DataOrigin.PLEOS))
        override suspend fun connect()=Unit
        override fun close()=Unit
    }
    private class Voice:StreamingVoiceGateway {
        override val state=MutableStateFlow(SpeechState(available=true,origin=DataOrigin.PLEOS))
        override val transcripts=MutableSharedFlow<String>()
        override val voiceEvents=MutableSharedFlow<VoiceEvent>(extraBufferCapacity=32)
        val spoken=CopyOnWriteArrayList<String>();var turn:String?=null
        override suspend fun listen()=Unit
        override suspend fun speak(text:String){spoken+=text}
        override suspend fun speakChunk(turnId:String,text:String,isFinal:Boolean){turn=turnId;spoken+=text}
        override fun interruptSpeech()=Unit
        override fun stop()=Unit
        override fun close()=Unit
    }
    companion object{private fun stop(id:String)=RouteStop(id,id,Coordinate(37.5,127.0))}
}
