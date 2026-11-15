package ai.pleos.carmeleon.desktop

import ai.pleos.carmeleon.core.*
import ai.pleos.carmeleon.agent.*
import javax.swing.JFileChooser
import java.nio.file.Files
import ai.pleos.carmeleon.ui.CarmeleonApp
import ai.pleos.carmeleon.ui.DiagnosticReplayEvent
import ai.pleos.carmeleon.ui.DiagnosticReplayScreen
import kotlinx.serialization.json.*
import androidx.compose.runtime.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.window.*
import kotlinx.coroutines.*
import kotlinx.coroutines.swing.Swing
import kotlinx.coroutines.flow.first
import java.awt.Window as AwtWindow
import java.io.File
import java.time.Instant
import javax.imageio.ImageIO
import org.jetbrains.skiko.SkiaLayer
import org.jetbrains.skiko.toBufferedImage

fun main(args: Array<String>) = application {
    val scope=rememberCoroutineScope()
    val navigation=remember { PreviewNavigationGateway(scope) }
    val location=remember { PreviewLocationGateway() }
    val vehicle=remember { PreviewVehicleGateway() }
    val voice=remember { PreviewVoiceGateway() }
    val backendUrl=System.getenv("CARMELEON_BACKEND_URL")?.takeIf { it.isNotBlank() }
    val repository=remember(backendUrl) { backendUrl?.let { BunJourneyRepository(HttpUrlConnectionTransport(),it) } }
    val controller=remember { JourneyController(scope,navigation,location,voice,vehicle,repository) }
    val agentUrl = System.getenv("CARMELEON_AGENT_URL")?.takeIf { it.isNotBlank() } ?: "http://localhost:3001"
    val agent = remember { AgentRuntime(scope, controller, navigation, voice, runCatching { AgentHttpClient(agentUrl, SessionTokenVault()) }.getOrNull(), FileAgentLocalStore(File(System.getProperty("user.home"), ".carmeleon/agent-cache"))) }
    val agentState by agent.state.collectAsState()
    var replay by remember { mutableStateOf<List<DiagnosticReplayEvent>?>(null) }
    replay?.let { events ->
        Window(onCloseRequest = { replay = null }, title = "CARmeleon · 진단 재생 · SDK 실행 아님", state = rememberWindowState(width = 760.dp, height = 650.dp)) {
            DiagnosticReplayScreen(events)
        }
    }
    DisposableEffect(Unit) { controller.connect(); onDispose { agent.close(); controller.release() } }
    val windowState=rememberWindowState(width=1280.dp,height=800.dp)
    Window(onCloseRequest=::exitApplication,title="CARmeleon · Kotlin Desktop Preview",state=windowState) {
        MenuBar {
            Menu("미리보기") {
                Item("진단 기록 열기", onClick = {
                    val picker = JFileChooser().apply { dialogTitle = "JSON 진단 사건 열기" }
                    if (picker.showOpenDialog(window) == JFileChooser.APPROVE_OPTION) runCatching {
                        require(picker.selectedFile.length() <= 1024 * 1024) { "진단 기록은 1MB까지 열 수 있습니다." }
                        val document = Json.parseToJsonElement(picker.selectedFile.readText(Charsets.UTF_8)).jsonObject
                        replay = document["events"]!!.jsonArray.take(400).map { element ->
                            val event = element.jsonObject
                            DiagnosticReplayEvent(event["at"]?.jsonPrimitive?.content.orEmpty().take(60), event["event"]?.jsonPrimitive?.content.orEmpty().take(120), event["status"]?.jsonPrimitive?.content.orEmpty().take(100))
                        }
                    }.onFailure { agent.showError(it.message ?: "진단 기록을 읽지 못했습니다.") }
                })
                Separator()
                Item("식사 요청",onClick={controller.propose(PoiKind.MEAL)})
                Item("충전 요청",onClick={controller.propose(PoiKind.CHARGER)})
                Item("화장실 요청",onClick={controller.propose(PoiKind.RESTROOM)})
                Separator()
                Item("다음 내비 요청 실패 시연",onClick={navigation.failNext=true})
                Item("목적지 도착 시연",onClick={navigation.arrive()})
                Separator()
                Item("후진 상태 시연",onClick={vehicle.setGear(Gear.REVERSE)})
                Item("주행 상태로 복귀",onClick={vehicle.setGear(Gear.DRIVE)})
                Item("내비 안내 시작",onClick={vehicle.setNavigationSpeaking(true)})
                Item("내비 안내 종료",onClick={vehicle.setNavigationSpeaking(false)})
                Separator()
                Item("배고프다는 발화 시연",onClick={voice.say("배고파. 밥 먹고 가자")})
            }
        }
        CarmeleonApp(controller,initialDark=args.contains("--dark"),initialReducedMotion=args.contains("--reduce-motion"),
            agent=agentState,onAgentSubmit=agent::submit,onAgentChoice={ id, accepted -> agent.decide(id,accepted) },onAgentCancel={agent.interrupt()},
            onMicrophoneToggle=agent::toggleMicrophone,onMemorySave=agent::saveMemory,onMemoryUpdate=agent::updateMemory,onMemoryDelete=agent::deleteMemory,
            onMaterialAdd=agent::addMaterial,onMaterialDelete=agent::deleteMaterial,onMaterialPick={
                val picker = JFileChooser().apply { dialogTitle = "경로에 자료 추가" }
                if (picker.showOpenDialog(window) == JFileChooser.APPROVE_OPTION) {
                    val file = picker.selectedFile
                    if (file.length() <= 20 * 1024 * 1024) agent.uploadMaterial(file.name,file.readBytes(),Files.probeContentType(file.toPath()) ?: "application/octet-stream")
                    else agent.showError("자료는 20MB까지 추가할 수 있습니다.")
                }
            },onRouteEdit=agent::editRoute,onAuthenticate=agent::authenticate,onLogout=agent::logout,
                onRefresh=agent::refreshAccount,onSelectPath=agent::selectPath,onCreatePath=agent::createPath,onOpenNavigationSearch=agent::openNavigationSearch,onOpenRouteOptions=agent::openRouteOptions,onExportDiagnostics={
                    val picker = JFileChooser().apply { dialogTitle = "진단 기록 저장"; selectedFile = File("carmeleon-diagnostics-${System.currentTimeMillis()}.json") }
                    if (picker.showSaveDialog(window) == JFileChooser.APPROVE_OPTION) {
                        val target = picker.selectedFile
                        if (!target.exists()) target.writeText(agent.diagnostics.export("WINDOWS_PREVIEW"), Charsets.UTF_8)
                        else agent.showError("기존 파일을 보존했습니다. 다른 파일 이름을 선택해 주세요.")
                    }
                })
        if (args.contains("--verify")) {
            LaunchedEffect(Unit) {
                val suffix = buildString {
                    if (args.contains("--dark")) append("-dark")
                    if (args.contains("--reduce-motion")) append("-reduced")
                }
                val result = verifyNativeJourney(controller,navigation,vehicle,window,suffix,
                    resize={width,height->windowState.size=DpSize(width.dp,height.dp)})
                println("CARMELEON_NATIVE_VERIFICATION: status=${result.status}, checks=${result.checks.size}, captures=${result.captures.size}, report=${result.report.absolutePath}")
                if (result.status != "passed") System.err.println("CARMELEON_NATIVE_VERIFICATION_FAILED: ${result.failure}")
                if (args.contains("--exit")) {
                    if (result.status != "passed") kotlin.system.exitProcess(1)
                    exitApplication()
                }
            }
        }
    }
}

private data class NativeCheck(val name:String,val details:String)
private data class NativeCapture(val name:String,val file:String,val phase:String,val accepted:Boolean,val stopIds:List<String>,val arrival:Int,val width:Int,val height:Int)
private data class NativeVerification(val status:String,val checks:List<NativeCheck>,val captures:List<NativeCapture>,val report:File,val failure:String?)

/** Observe business state before taking pixels; elapsed sleeps are never used as success evidence. */
private suspend fun verifyNativeJourney(
    controller:JourneyController,
    navigation:PreviewNavigationGateway,
    vehicle:PreviewVehicleGateway,
    window:AwtWindow,
    suffix:String,
    resize:(Int,Int)->Unit,
):NativeVerification {
    val projectRoot = generateSequence(File(System.getProperty("user.dir")).canonicalFile) { it.parentFile }
        .first { File(it, "settings.gradle.kts").isFile }
    val out=File(projectRoot,"verification/screenshots").apply { mkdirs() }
    val report=File(out,"native-verification$suffix.json")
    val checks=mutableListOf<NativeCheck>()
    val captures=mutableListOf<NativeCapture>()
    val started=Instant.now().toString()
    var failure:String?=null
    suspend fun awaitState(name:String,predicate:(JourneyState)->Boolean):JourneyState = try {
        withTimeout(25_000) { controller.state.first(predicate) }
    } catch (timeout:TimeoutCancellationException) {
        val state=controller.state.value
        throw IllegalStateException("$name timed out: phase=${state.phase}, pending=${state.pendingRequestId}, proposalVisible=${state.proposalVisible}, error=${state.error}",timeout)
    }
    fun verify(name:String,condition:Boolean,details:String) {
        check(condition) { "$name: $details" }
        checks += NativeCheck(name,details)
    }
    suspend fun capture(name:String,predicate:(JourneyState)->Boolean) {
        awaitState("$name before capture",predicate)
        // Business state was already asserted. Settle only appearance: an idle/minimized
        // desktop frame clock need not emit continuous frames after a finite transition.
        withContext(Dispatchers.Swing) { window.toFront(); window.requestFocus(); window.repaint() }
        delay(850)
        val pixels = withContext(Dispatchers.Swing) {
            check(window.isShowing) { "Native window is not visible" }
            fun findLayer(component: java.awt.Component): SkiaLayer? {
                if (component is SkiaLayer) return component
                if (component is java.awt.Container) component.components.forEach { child -> findLayer(child)?.let { return it } }
                return null
            }
            val layer = findLayer(window) ?: error("No owned Skia layer in the native window")
            val bitmap = layer.screenshot() ?: error("Native Skia layer has no rendered framebuffer")
            try {
                // Skiko's BufferedImage can share native bitmap memory. Detach all pixels
                // while the bitmap is alive before handing the image to an IO worker.
                val borrowed = bitmap.toBufferedImage()
                val detached = java.awt.image.BufferedImage(borrowed.width, borrowed.height, java.awt.image.BufferedImage.TYPE_INT_ARGB)
                val graphics = detached.createGraphics()
                try { graphics.drawImage(borrowed, 0, 0, null) } finally { graphics.dispose() }
                detached
            } finally { bitmap.close() }
        }
        val file=File(out,"$name$suffix.png")
        val stateBefore=controller.state.value
        check(predicate(stateBefore)) { "$name changed before pixel capture: ${stateBefore.phase}" }
        withContext(Dispatchers.IO) {
            check(ImageIO.write(pixels,"png",file)) { "No PNG writer available" }
        }
        val stateAfter=controller.state.value
        check(predicate(stateAfter)) { "$name changed during pixel capture: ${stateAfter.phase}" }
        captures += NativeCapture(name,file.absolutePath,stateAfter.phase.name,stateAfter.acceptedDetour,stateAfter.route.stops.map { it.id },stateAfter.route.arrivalMinuteOfDay,pixels.width,pixels.height)
    }

    try {
        awaitState("preview connected") { it.connection.status==ConnectionStatus.CONNECTED&&it.phase==JourneyPhase.READY&&!it.isPending }
        capture("desktop-ready") { it.phase==JourneyPhase.READY&&!it.isPending }
        val original=controller.state.value.route
        controller.start()
        awaitState("departure requested") { it.isPending&&it.phase==JourneyPhase.REQUESTING }
        verify("departure_keeps_original_route",controller.state.value.route==original,"Original itinerary remains while navigation is pending")
        awaitState("departure completed") { it.phase==JourneyPhase.DRIVING&&!it.isPending }
        verify("departure_completed",true,"Preview Completed event reached DRIVING")
        capture("desktop-driving") { it.phase==JourneyPhase.DRIVING&&!it.isPending }

        controller.propose(PoiKind.MEAL)
        awaitState("meal proposed") { it.phase==JourneyPhase.PROPOSAL&&it.proposalVisible&&it.proposal?.kind==PoiKind.MEAL&&!it.busyFinding }
        capture("desktop-proposal") { it.phase==JourneyPhase.PROPOSAL&&it.proposalVisible&&it.proposal?.kind==PoiKind.MEAL }
        controller.dismissProposal()
        awaitState("meal rejected") { !it.proposalVisible&&it.phase==JourneyPhase.DRIVING }
        verify("reject_preserves_route",controller.state.value.route==original,"Rejecting a proposal did not change the itinerary")

        controller.propose(PoiKind.MEAL)
        awaitState("meal proposed again") { it.phase==JourneyPhase.PROPOSAL&&it.proposalVisible&&!it.busyFinding }
        val mealId=controller.state.value.proposal!!.stop.id
        controller.approveProposal()
        awaitState("meal requested") { it.phase==JourneyPhase.REQUESTING&&it.isPending }
        verify("approval_is_not_completion",controller.state.value.route==original,"Approval alone did not commit the proposed stop")
        awaitState("meal confirmed") { it.phase==JourneyPhase.CONFIRMED&&!it.isPending&&it.acceptedDetour&&it.route.stops.any { stop->stop.id==mealId } }
        val mealRoute=controller.state.value.route
        verify("meal_committed_after_callback",mealRoute.stops.size==original.stops.size+1,"Exactly one meal stop was committed after Completed")
        capture("desktop-confirmed") { it.phase==JourneyPhase.CONFIRMED&&it.acceptedDetour&&it.route==mealRoute }
        controller.dismissProposal()
        awaitState("continued after meal") { it.phase==JourneyPhase.DRIVING&&!it.proposalVisible }
        verify("dismiss_preserves_accepted_route",controller.state.value.route==mealRoute,"Closing the accepted proposal retained its stop and ETA")
        capture("desktop-continued") { it.phase==JourneyPhase.DRIVING&&!it.proposalVisible&&it.route==mealRoute }

        navigation.failNext=true
        controller.propose(PoiKind.CHARGER)
        awaitState("charger proposed") { it.phase==JourneyPhase.PROPOSAL&&it.proposalVisible&&it.proposal?.kind==PoiKind.CHARGER&&!it.busyFinding }
        val chargerId=controller.state.value.proposal!!.stop.id
        controller.approveProposal()
        awaitState("expected navigation failure") { it.phase==JourneyPhase.FAILED&&!it.isPending&&it.error!=null }
        verify("failure_preserves_route",controller.state.value.route==mealRoute,"Injected navigation failure retained the accepted meal itinerary")
        capture("desktop-failed-request") { it.phase==JourneyPhase.FAILED&&!it.isPending&&it.route==mealRoute }
        controller.retry()
        awaitState("retry confirmed") { it.phase==JourneyPhase.CONFIRMED&&!it.isPending&&it.route.stops.any { stop->stop.id==chargerId } }
        val retriedRoute=controller.state.value.route
        verify("retry_commits_once",retriedRoute.stops.count { it.id==chargerId }==1&&retriedRoute.stops.any { it.id==mealId },"Retry added one charger while retaining the meal stop")
        capture("desktop-retried-request") { it.phase==JourneyPhase.CONFIRMED&&it.route==retriedRoute }

        resize(640,900)
        capture("desktop-compact-confirmed") { it.phase==JourneyPhase.CONFIRMED&&it.route==retriedRoute }
        verify("compact_window_applied",captures.last().width<captures.first().width,"Narrow native capture is smaller than the expanded capture")
        resize(1280,800)
        controller.continueJourney()
        awaitState("continued after retry") { it.phase==JourneyPhase.DRIVING&&!it.proposalVisible }
        vehicle.setGear(Gear.REVERSE)
        awaitState("reverse state") { it.vehicle.gear==Gear.REVERSE&&!it.vehicle.canSpeak }
        val beforeHeldSpeech=controller.state.value.speech.message
        val heldText="주행 상태 복귀 후 안내 재개 검증"
        controller.speak(heldText)
        awaitState("speech held") { it.message==it.vehicle.speechHoldReason&&!it.vehicle.canSpeak }
        verify("reverse_holds_speech",controller.state.value.speech.message==beforeHeldSpeech,"Reverse gear withheld the preview utterance")
        capture("desktop-safety") { it.vehicle.gear==Gear.REVERSE&&!it.vehicle.canSpeak }
        vehicle.setGear(Gear.DRIVE)
        awaitState("speech resumed") { it.vehicle.gear==Gear.DRIVE&&it.speech.message.contains(heldText) }
        verify("speech_resumes_after_safety",true,"Deferred preview speech resumed only after leaving reverse gear")

        navigation.arrive()
        awaitState("destination arrived") { it.phase==JourneyPhase.ARRIVED&&it.currentStopIndex==it.route.stops.size }
        verify("arrival_preserves_itinerary",controller.state.value.route==retriedRoute,"Arrival completed the segment without dropping day-plan stops")
        capture("desktop-arrived") { it.phase==JourneyPhase.ARRIVED&&it.route==retriedRoute }
    } catch (error:TimeoutCancellationException) {
        failure="Native frame/window capture timed out: ${error.message}"
    } catch (error:CancellationException) {
        failure="Verification cancelled: ${error.message}"
        throw error
    } catch (error:Throwable) {
        failure="${error::class.simpleName}: ${error.message}"
    } finally {
        val current=controller.state.value
        val status=if(failure==null)"passed" else "failed"
        val json=buildString {
            append("{\n  \"status\": ").append(jsonString(status)).append(",\n  \"startedAt\": ").append(jsonString(started))
            append(",\n  \"finishedAt\": ").append(jsonString(Instant.now().toString()))
            append(",\n  \"source\": \"Owned Skia framebuffer from Windows native Compose window; not a desktop screenshot or Pleos vehicle run\"")
            append(",\n  \"finalPhase\": ").append(jsonString(current.phase.name))
            append(",\n  \"failure\": ").append(failure?.let(::jsonString)?:"null")
            append(",\n  \"checks\": [").append(checks.joinToString(",") { "{\"name\":${jsonString(it.name)},\"passed\":true,\"details\":${jsonString(it.details)}}" }).append("]")
            append(",\n  \"captures\": [").append(captures.joinToString(",") { capture->
                "{\"name\":${jsonString(capture.name)},\"file\":${jsonString(capture.file)},\"phase\":${jsonString(capture.phase)},\"acceptedDetour\":${capture.accepted},\"arrivalMinuteOfDay\":${capture.arrival},\"width\":${capture.width},\"height\":${capture.height},\"stopIds\":[${capture.stopIds.joinToString(",",transform=::jsonString)}]}"
            }).append("]\n}\n")
        }
        withContext(NonCancellable+Dispatchers.IO) { report.writeText(json,Charsets.UTF_8) }
    }
    return NativeVerification(if(failure==null)"passed" else "failed",checks,captures,report,failure)
}

private fun jsonString(value:String):String=buildString {
    append('"')
    value.forEach { character->when(character) {
        '"'->append("\\\"")
        '\\'->append("\\\\")
        '\n'->append("\\n")
        '\r'->append("\\r")
        '\t'->append("\\t")
        else->if(character.code<32)append("\\u").append(character.code.toString(16).padStart(4,'0'))else append(character)
    } }
    append('"')
}
