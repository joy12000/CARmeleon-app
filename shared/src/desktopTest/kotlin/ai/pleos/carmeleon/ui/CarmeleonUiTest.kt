package ai.pleos.carmeleon.ui

import ai.pleos.carmeleon.core.*
import androidx.compose.ui.graphics.asSkiaBitmap
import androidx.compose.ui.test.*
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import org.jetbrains.skia.EncodedImageFormat
import org.jetbrains.skia.Image
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Real Compose semantics and Skia-rendered captures. Navigation acknowledgements are explicit fakes. */
@OptIn(ExperimentalTestApi::class)
class CarmeleonUiTest {
    @Test fun wideLightJourney() = verifyJourney(width=1180,height=760,dark=false,name="compose-wide-light")
    @Test fun wideDarkJourney() = verifyJourney(width=1180,height=760,dark=true,name="compose-wide-dark")
    @Test fun narrowLightJourney() = verifyJourney(width=358,height=900,dark=false,name="compose-narrow-light")
    @Test fun narrowDarkJourney() = verifyJourney(width=358,height=900,dark=true,name="compose-narrow-dark")

    @Test fun choicesAreExplicitAndSubtitlesAreOptional() = runDesktopComposeUiTest(width=1180,height=760) {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=JourneyController(scope,AcknowledgedNavigation())
        val decisions=mutableListOf<Pair<String,Boolean>>()
        try {
            setContent { CarmeleonApp(controller,initialReducedMotion=true,agent=AgentUiState(connected=true,phase=AgentUiPhase.WAITING,subtitle="짧은 답변",choices=listOf(AgentChoiceUi("change-1","여의도를 경유할까요?","경유지 한 곳 추가"))),onAgentChoice={id,approved->decisions+=id to approved}) }
            onNodeWithTag("agent-subtitle").assertDoesNotExist()
            onNodeWithTag("agent-choice").assertIsDisplayed()
            onNodeWithTag("agent-approve-change-1").performClick()
            runOnIdle { assertEquals(listOf("change-1" to true),decisions) }
            onNodeWithTag("guidance-toggle").performClick()
            onNodeWithTag("show-subtitles").performClick()
            onNodeWithTag("close-panel").performClick()
            onNodeWithTag("agent-subtitle").assertTextEquals("짧은 답변")
        } finally { controller.release();scope.cancel() }
    }

    @Test fun inputAndMemoryDeletionDelegateOnce() = runDesktopComposeUiTest(width=1180,height=760) {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=JourneyController(scope,AcknowledgedNavigation())
        val submitted=mutableListOf<String>();val deleted=mutableListOf<String>()
        try {
            setContent { CarmeleonApp(controller,initialReducedMotion=true,agent=AgentUiState(connected=true,memories=listOf(AgentMemoryUi("memory-1","매운 음식은 피하기"))),onAgentSubmit={submitted+=it},onMemoryDelete={deleted+=it}) }
            onNodeWithTag("agent-input-open").performClick()
            onNodeWithTag("agent-text-input").performTextInput("여의도 들렀다가 가자")
            onNodeWithTag("agent-send").performClick()
            runOnIdle { assertEquals(listOf("여의도 들렀다가 가자"),submitted) }
            onNodeWithTag("memory-open").performClick()
            onNodeWithContentDescription("기억 삭제").performClick()
            runOnIdle { assertTrue(deleted.isEmpty()) }
            onNodeWithTag("confirm-delete").performClick()
            runOnIdle { assertEquals(listOf("memory-1"),deleted) }
        } finally { controller.release();scope.cancel() }
    }

    @Test fun drivingRestrictionsKeepLongEditingClosed() = runDesktopComposeUiTest(width=800,height=600) {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=JourneyController(scope,AcknowledgedNavigation())
        try {
            setContent { CarmeleonApp(controller,initialReducedMotion=true,agent=AgentUiState(connected=true,editable=false)) }
            onNodeWithTag("guidance-toggle").performClick()
            onNodeWithTag("settings-open-input").performScrollTo().performClick()
            onNodeWithTag("agent-text-input").assertDoesNotExist()
            onNodeWithText("주행 중에는 음성으로 말해 주세요.").assertExists()
            onNodeWithTag("close-panel").performClick()
            onNodeWithTag("route-toggle").performClick()
            onNodeWithTag("edit-route").assertDoesNotExist()
        } finally { controller.release();scope.cancel() }
    }

    @Test fun dualModeCallRoutesStartsPickedPath() = runDesktopComposeUiTest(width=358,height=900) {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=JourneyController(scope,AcknowledgedNavigation())
        val started=mutableListOf<String>()
        try {
            setContent {
                CarmeleonApp(
                    controller,
                    initialReducedMotion=true,
                    agent=AgentUiState(
                        connected=true,
                        paths=listOf(
                            AgentPathUi("path-1","카멜레온 미팅","양재 본사 · 남양연구소"),
                            AgentPathUi("path-2","수원 나들이","수원화성 · 광교 호수공원"),
                        ),
                        activePathId="path-1",
                    ),
                    onStartPath={ started+=it },
                )
            }
            onNodeWithTag("call-routes").assertIsDisplayed().performClick()
            onNodeWithTag("pick-start-path-path-2").performScrollTo().assertIsDisplayed().performClick()
            runOnIdle { assertEquals(listOf("path-2"), started) }
            onNodeWithTag("route-drawer").assertDoesNotExist()
        } finally { controller.release();scope.cancel() }
    }

    @Test fun unknownArrivalAndPathSelectionAreHonest() = runDesktopComposeUiTest(width=1180,height=760) {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=JourneyController(scope,AcknowledgedNavigation(),initialRoute=sampleRoute().copy(durationMinutes=0,distanceKm=0.0))
        val selected=mutableListOf<String>();val created=mutableListOf<String>()
        try {
            setContent { CarmeleonApp(controller,initialReducedMotion=true,agent=AgentUiState(connected=true,paths=listOf(AgentPathUi("path-1","기본 경로"),AgentPathUi("path-2","다음 방문")),activePathId="path-1"),onSelectPath={selected+=it},onCreatePath={created+=it}) }
            onNodeWithTag("arrival-time").assertTextEquals("안내에서 확인")
            onNodeWithTag("route-toggle").performClick()
            onNodeWithTag("paths-toggle").performClick()
            onNodeWithTag("select-path-path-2").performClick()
            onNodeWithTag("new-path-title").performTextInput("서울 여행")
            onNodeWithTag("create-path").performClick()
            runOnIdle { assertEquals(listOf("path-2"),selected);assertEquals(listOf("서울 여행"),created) }
        } finally { controller.release();scope.cancel() }
    }

    @Test fun stopEditingPreservesScheduleAndMaterialLinks() = runDesktopComposeUiTest(width=1180,height=760) {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val stop=sampleRoute().stops.first().copy(purpose="미팅",dwellMinutes=30,appointmentAt="2026-11-12T14:30:00+09:00",timeZone="Asia/Seoul",materialIds=listOf("material-1"))
        val controller=JourneyController(scope,AcknowledgedNavigation(),initialRoute=sampleRoute().copy(stops=listOf(stop)))
        val applied=mutableListOf<List<RouteStop>>()
        try {
            setContent { CarmeleonApp(controller,initialReducedMotion=true,agent=AgentUiState(connected=true,materials=listOf(AgentMaterialUi("material-1","회의 자료","읽기 가능"))),onRouteEdit={applied+=it}) }
            onNodeWithTag("route-toggle").performClick()
            onNodeWithTag("edit-route").performClick()
            onNodeWithTag("edit-stop-${stop.id}").performClick()
            onNodeWithTag("route-place-name").performTextReplacement("새 미팅 장소")
            onNodeWithTag("stop-advanced").performScrollTo().performClick()
            onNodeWithTag("route-stop-purpose").performScrollTo().assertTextContains("미팅")
            onNodeWithTag("save-stop-draft").performScrollTo().performClick()
            onNodeWithTag("apply-route-edit").performScrollTo().performClick()
            runOnIdle {
                val result=applied.single().single()
                assertEquals("새 미팅 장소",result.name)
                assertEquals(stop.purpose,result.purpose)
                assertEquals(stop.appointmentAt,result.appointmentAt)
                assertEquals(stop.timeZone,result.timeZone)
                assertEquals(stop.materialIds,result.materialIds)
            }
        } finally { controller.release();scope.cancel() }
    }

    @Test fun connectionErrorOffersSettingsAndDiagnosticsExport() = runDesktopComposeUiTest(width=1180,height=760) {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val controller=JourneyController(scope,AcknowledgedNavigation())
        var exports=0
        try {
            setContent { CarmeleonApp(controller,initialReducedMotion=true,agent=AgentUiState(phase=AgentUiPhase.ERROR,notice="서버에 연결하지 못했어요."),onExportDiagnostics={exports++}) }
            onNodeWithTag("agent-notice").assertTextEquals("서버에 연결하지 못했어요.")
            onNodeWithTag("agent-error-settings").performClick()
            onNodeWithTag("export-diagnostics").performScrollTo().performClick()
            runOnIdle { assertEquals(1,exports) }
        } finally { controller.release();scope.cancel() }
    }

    private fun verifyJourney(width:Int,height:Int,dark:Boolean,name:String) = runDesktopComposeUiTest(width=width,height=height) {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val navigation=AcknowledgedNavigation()
        val controller=JourneyController(scope,navigation,requestTimeoutMillis=60_000)
        try {
            controller.connect()
            setContent { CarmeleonApp(controller,initialDark=dark,initialReducedMotion=true) }
            waitForIdle()
            val dualMode = width < 1080
            if (dualMode) {
                onNodeWithTag("location-unknown").assertDoesNotExist()
            } else {
                onNodeWithTag("location-unknown").assertExists()
            }
            saveCapture("$name-ready")
            onNodeWithTag("agent-wave").assertExists()
            onNodeWithTag("mode-business").assertDoesNotExist()
            onNodeWithTag("dock-meal").assertDoesNotExist()
            onNodeWithTag("request-charger").assertDoesNotExist()
            onNodeWithTag("proposal-sheet").assertDoesNotExist()
            onNodeWithTag("agent-choice").assertDoesNotExist()
            if (dualMode) {
                onNodeWithTag("call-routes").assertIsDisplayed().performClick()
                onNodeWithTag("route-drawer").assertIsDisplayed()
                onNodeWithTag("start").assertIsDisplayed().performClick()
            } else {
                onNodeWithTag("start").assertIsDisplayed().performClick()
            }
            runOnIdle { assertEquals(JourneyPhase.REQUESTING,controller.state.value.phase);navigation.complete() }
            waitUntil(timeoutMillis=5_000){controller.state.value.phase==JourneyPhase.DRIVING}
            if (dualMode) {
                onNodeWithTag("call-routes").assertDoesNotExist()
                onNodeWithTag("listen").assertIsDisplayed()
                onNodeWithTag("route-toggle").assertIsDisplayed()
            }
            val original=controller.state.value.route
            runOnIdle { controller.propose(PoiKind.MEAL) }
            waitUntil(timeoutMillis=5_000){controller.state.value.proposalVisible}
            if(width<760)onNodeWithTag("reject-proposal").performScrollTo()
            onNodeWithTag("reject-proposal").performClick()
            runOnIdle { assertEquals(original,controller.state.value.route);assertEquals(false,controller.state.value.proposalVisible) }
            runOnIdle { controller.propose(PoiKind.MEAL) }
            waitUntil(timeoutMillis=5_000){controller.state.value.proposalVisible}
            val proposedArrival=assertNotNull(controller.state.value.proposal).arrivalMinuteOfDay
            if(width<760)onNodeWithTag("approve").performScrollTo()
            onNodeWithTag("approve").performClick()
            runOnIdle { assertEquals(JourneyPhase.REQUESTING,controller.state.value.phase);assertEquals(original,controller.state.value.route);navigation.complete() }
            waitUntil(timeoutMillis=5_000){controller.state.value.phase==JourneyPhase.CONFIRMED}
            runOnIdle { assertNotEquals(original,controller.state.value.route);assertEquals(proposedArrival,controller.state.value.route.arrivalMinuteOfDay) }
            waitForIdle()
            onNodeWithTag("proposal-sheet").assertDoesNotExist()
            saveCapture(name)
            runOnIdle { controller.continueJourney() }
            runOnIdle { assertEquals(false,controller.state.value.proposalVisible);assertEquals(proposedArrival,controller.state.value.route.arrivalMinuteOfDay) }
            val committedMealRoute=controller.state.value.route
            val committedMealName=committedMealRoute.stops.first { it.kind==PoiKind.MEAL }.name
            runOnIdle { controller.propose(PoiKind.CHARGER) }
            waitUntil(timeoutMillis=5_000){controller.state.value.proposalVisible&&controller.state.value.proposal?.kind==PoiKind.CHARGER}
            val chargerMinutes=assertNotNull(controller.state.value.proposal).extraDrivingMinutes
            if (!dualMode) {
                onNodeWithTag("map-proposal-marker").assertExists()
                onNodeWithText("제안 · +${chargerMinutes}분").assertExists()
            } else {
                onNodeWithTag("map-proposal-marker").assertDoesNotExist()
            }
            runOnIdle { assertEquals(committedMealRoute,controller.state.value.route);assertEquals(proposedArrival,controller.state.value.route.arrivalMinuteOfDay) }
            if(width<760)onNodeWithTag("approve").performScrollTo()
            onNodeWithTag("approve").performClick()
            runOnIdle { navigation.fail() }
            waitUntil(timeoutMillis=5_000){controller.state.value.phase==JourneyPhase.FAILED}
            if (!dualMode) onNodeWithTag("map-proposal-marker").assertExists()
            runOnIdle { assertEquals(committedMealRoute,controller.state.value.route) }
            if(width<760)onNodeWithTag("reject-proposal").performScrollTo()
            onNodeWithTag("reject-proposal").performClick()
            waitForIdle()
            onNodeWithTag("map-proposal-marker").assertDoesNotExist()
            if (!dualMode) onNodeWithTag("map-committed-marker").assertContentDescriptionEquals("확정 경유지 $committedMealName")
            else {
                onNodeWithTag("map-committed-marker").assertDoesNotExist()
                onNodeWithTag("agent-wave").assertIsDisplayed()
            }
            runOnIdle { assertEquals(committedMealRoute,controller.state.value.route);assertEquals(proposedArrival,controller.state.value.route.arrivalMinuteOfDay) }
            onNodeWithTag("route-toggle").performClick()
            onNodeWithTag("route-drawer").assertIsDisplayed()
            // The drawer is the scroll container; scroll its actionable child into view.
            onNodeWithTag("close-route").performScrollTo().assertIsDisplayed().performClick()
            waitForIdle()
            onNodeWithTag("route-drawer").assertDoesNotExist()
            onNodeWithTag("guidance-toggle").performClick()
            onNodeWithTag("reduce-motion").assertIsOn().performClick().assertIsOff()
        } finally {
            controller.release()
            scope.cancel()
        }
    }

    private fun DesktopComposeUiTest.saveCapture(name:String) {
        val root=generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }.first { File(it,"settings.gradle.kts").exists() }
        val target=File(root,"verification/screenshots/$name.png")
        target.parentFile.mkdirs()
        val bitmap=onNodeWithTag("carmeleon-app").captureToImage()
        val image=Image.makeFromBitmap(bitmap.asSkiaBitmap())
        val data=assertNotNull(image.encodeToData(EncodedImageFormat.PNG))
        target.writeBytes(data.bytes)
        assertTrue(target.length()>10_000,"Capture should contain a rendered vehicle interface")
        data.close()
        image.close()
    }

    private class AcknowledgedNavigation:NavigationGateway {
        override val connection=MutableStateFlow(ServiceConnection(ConnectionStatus.CONNECTED,"Compose UI 테스트 차량",DataOrigin.PREVIEW))
        override val events=MutableSharedFlow<NavigationEvent>(extraBufferCapacity=8)
        private var latest:NavigationRequest?=null
        override suspend fun connect() { connection.value=connection.value.copy(status=ConnectionStatus.CONNECTED) }
        override suspend fun request(request:NavigationRequest) { latest=request;events.emit(NavigationEvent.Requested(request.requestId)) }
        fun complete() { check(events.tryEmit(NavigationEvent.Completed(checkNotNull(latest).requestId))) }
        fun fail() { check(events.tryEmit(NavigationEvent.Failed(checkNotNull(latest).requestId,"UI 회귀검증: 충전소 요청 실패"))) }
        override suspend fun cancel(requestId:String) { events.emit(NavigationEvent.Cancelled(requestId)) }
        override fun close() { connection.value=connection.value.copy(status=ConnectionStatus.DISCONNECTED) }
    }
}
