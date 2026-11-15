package ai.pleos.carmeleon

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import ai.pleos.carmeleon.agent.AgentDiagnostics
import ai.pleos.carmeleon.core.*
import ai.pleos.carmeleon.pleos.*
import ai.pleos.carmeleon.ui.CarmeleonTheme
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import java.time.Instant

/**
 * Debug-only, model/key/server-independent SDK observation screen.
 * There is deliberately no navigation write or cancel operation here.
 * Missing services stay unsupported/failed; no PreviewGateway is used.
 */
class PleosDiagnosticsActivity : ComponentActivity() {
    private val scope = MainScope()
    private val diagnostics = AgentDiagnostics(capacity = 1000)
    private lateinit var navigation: PleosNavigationGateway
    private lateinit var location: PleosLocationGateway
    private lateinit var vehicle: PleosVehicleGateway
    private lateinit var voice: PleosVoiceGateway
    private lateinit var ux: AndroidDrivingRestrictions
    private var lines by mutableStateOf<List<String>>(emptyList())
    private var transcript by mutableStateOf("")
    private var feedback by mutableStateOf<String?>(null)
    private var permissionNotice by mutableStateOf("")
    private var microphoneGranted by mutableStateOf(false)
    private var chunkJob: Job? = null
    private val exported = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) scope.launch {
            try {
                record("diagnostics_export_requested")
                val payload = diagnostics.export("PLEOS_SDK_DIAGNOSTICS_NOT_AUTOMATICALLY_VERIFIED")
                withContext(Dispatchers.IO) {
                    contentResolver.openOutputStream(uri)?.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                        ?: error("저장 위치를 열지 못했습니다.")
                }
                feedback = "진단 기록을 저장했습니다. 전사 내용과 좌표는 포함하지 않았습니다."
                record("diagnostics_export_completed")
            } catch (error: Exception) {
                feedback = "진단 기록 저장 실패: ${error.message.orEmpty()}"
                record("diagnostics_export_failed", status = error.javaClass.simpleName)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vehicle = PleosVehicleGateway(this)
        navigation = PleosNavigationGateway(this)
        location = PleosLocationGateway(this)
        voice = PleosVoiceGateway(this, microphonePermissionGranted = ::hasMicrophone, onAudioFocusChanged = vehicle::setAudioFocusAllowed)
        ux = AndroidDrivingRestrictions(this)
        record("diagnostics_opened", status = "debug; real SDK adapters; no LLM; no navigation writes")
        observeGateways()
        setContent { DiagnosticSurface() }
        ux.connect()
    }

    private fun hasMicrophone() = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    private fun hasLocation() = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun onResume() {
        super.onResume()
        microphoneGranted = hasMicrophone()
        permissionNotice = listOfNotNull(if (!microphoneGranted) "마이크 권한 없음" else null, if (!hasLocation()) "위치 권한 없음" else null).joinToString(" · ")
        if (permissionNotice.isNotBlank()) permissionNotice += " · 앱 설정에서 허용한 뒤 돌아와 주세요."
    }

    private fun observeGateways() {
        scope.launch { navigation.connection.collect { record("navigation_connection", status = "${it.status};${it.origin}") } }
        scope.launch { location.connection.collect { record("location_connection", status = "${it.status};${it.origin}") } }
        scope.launch { navigation.observed.collect { record("observed_guidance", status = "${it.status};source=${it.origin};stops=${it.stops.size};version=${it.observationVersion};at=${it.observedAtMillis}") } }
        scope.launch { location.fixes.collect { record("location_fix", status = if (it == null) "unavailable" else "source=${it.origin};measuredAt=${it.measuredAtMillis}") } }
        scope.launch { vehicle.state.collect { record("vehicle_state", status = "gear=${it.gear};audio=${it.audioFocusAllowed};source=${it.origin}") } }
        scope.launch { ux.allowed.collect { allowed ->
            record("ux_editing_allowed", status = allowed?.toString() ?: "unknown")
            if (allowed != true) { chunkJob?.cancel(); voice.stop() }
        } }
        scope.launch { voice.state.collect { record("voice_state", status = "available=${it.available};listening=${it.listening};speaking=${it.speaking};source=${it.origin}") } }
        scope.launch { voice.transcripts.collect { text -> transcript = text; record("stt_final", status = "characters=${text.length}") } }
        scope.launch { voice.voiceEvents.collect { event ->
            when (event) {
                is VoiceEvent.Partial -> { transcript = event.text; record("stt_partial", status = "characters=${event.text.length}") }
                is VoiceEvent.SpeechDetected -> record("speech_detected", status = event.source)
                is VoiceEvent.PlaybackStarted -> record("tts_playback_started", event.turnId)
                is VoiceEvent.PlaybackDone -> record("tts_playback_done", event.turnId, "SDK completion; actual hearing unknown")
                is VoiceEvent.PlaybackInterrupted -> record("tts_interrupted", event.turnId)
                is VoiceEvent.PlaybackStopped -> record("tts_stop_confirmed", event.turnId)
                is VoiceEvent.Unavailable -> { feedback = event.reason; record("voice_unavailable") }
            }
        } }
    }

    /** Wall time plus monotonic elapsed time; never writes the transcript, coordinates or credentials. */
    private fun record(name: String, id: String? = null, status: String? = null) {
        val elapsed = SystemClock.elapsedRealtime()
        diagnostics.record(name, id, listOfNotNull("elapsedMs=$elapsed", status).joinToString(";"))
        lines = (lines + "${Instant.now()}  $name${id?.let { " [$it]" }.orEmpty()}${status?.let { " · $it" }.orEmpty()}").takeLast(160)
    }

    private fun action(name: String, block: suspend () -> Unit) {
        scope.launch {
            record(name)
            feedback = null
            try { block() }
            catch (error: Exception) { feedback = "요청 실패: ${error.message.orEmpty()}"; record("${name}_failed", status = error.javaClass.simpleName) }
        }
    }

    private fun connectServices() {
        action("connect_requested") {
            // SDK connection attempts are independent; a failure in one must not hide the others.
            listOf<suspend () -> Unit>({ navigation.connect() }, { location.connect() }, { vehicle.connect() }).forEachIndexed { index, connect ->
                try { connect() } catch (error: Exception) { record("connect_failed", status = "adapter=$index;${error.javaClass.simpleName}"); feedback = "SDK 연결 실패: ${error.message.orEmpty()}" }
            }
            ux.connect()
        }
    }

    private fun recordSnapshot() {
        val actual = navigation.observed.value
        record("snapshot_requested", status = "currently observed values; SDK navigation poll continues independently")
        record("snapshot_guidance", status = "${actual.status};source=${actual.origin};stops=${actual.stops.size};observedAt=${actual.observedAtMillis}")
        record("snapshot_voice", status = "available=${voice.state.value.available};listening=${voice.state.value.listening};speaking=${voice.state.value.speaking}")
        record("snapshot_location", status = "source=${location.fixes.value?.origin};measuredAt=${location.fixes.value?.measuredAtMillis}")
        feedback = "현재 관찰값을 기록했습니다. 내비 경로를 변경하지 않았습니다."
    }

    private fun ttsTest(chunked: Boolean) {
        chunkJob?.cancel()
        chunkJob = scope.launch {
            if (ux.allowed.value != true) { feedback = "플랫폼에서 편집 가능 상태가 확인된 후 시험해 주세요."; return@launch }
            val turn = "sdk-test-${SystemClock.elapsedRealtime()}"
            try {
                record("tts_chunk_submitted", turn, "isFinal=${!chunked}")
                voice.speakChunk(turn, "카멜레온 음성 확인입니다.", !chunked)
                if (chunked) {
                    delay(600)
                    ensureActive()
                    record("tts_chunk_submitted", turn, "isFinal=true")
                    voice.speakChunk(turn, "마지막 조각입니다.", true)
                }
            } catch (_: CancellationException) { record("tts_test_cancelled", turn) }
            catch (error: Exception) { feedback = "음성 시험 실패: ${error.message.orEmpty()}"; record("tts_test_failed", turn, error.javaClass.simpleName) }
        }
    }

    @Composable
    private fun DiagnosticSurface() {
        val nav by navigation.connection.collectAsState()
        val actual by navigation.observed.collectAsState()
        val loc by location.connection.collectAsState()
        val fix by location.fixes.collectAsState()
        val vehicleState by vehicle.state.collectAsState()
        val speech by voice.state.collectAsState()
        val editingAllowed by ux.allowed.collectAsState()
        CarmeleonTheme(false) {
            Surface(Modifier.fillMaxSize()) {
                Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = ::finish, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.ArrowBack, "앱으로 돌아가기") }
                        Text("Pleos SDK 확인", style = MaterialTheme.typography.titleLarge)
                    }
                    Text("개발 빌드 · 실제 SDK 어댑터 · 모델·서버 연결 불필요", style = MaterialTheme.typography.bodyMedium)
                    if (permissionNotice.isNotBlank()) Text(permissionNotice, color = MaterialTheme.colorScheme.error)
                    Text("UX 편집 허용: ${editingAllowed?.toString() ?: "미확인"}", style = MaterialTheme.typography.bodyMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(onClick = ::connectServices, modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("sdk-connect")) { Text("SDK 연결") }
                        OutlinedButton(onClick = ::recordSnapshot, modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("sdk-record")) { Text("관찰값 기록") }
                    }
                    Text("내비 ${nav.status} · ${nav.origin}", style = MaterialTheme.typography.titleMedium)
                    Text(nav.message, style = MaterialTheme.typography.bodyMedium)
                    Text("실제 관찰: ${actual.status} · ${actual.origin} · 관찰 시각 ${actual.observedAtMillis ?: "미확인"}", style = MaterialTheme.typography.bodyMedium)
                    Text("routeId ${actual.routeId ?: "미확인"} · 경유/목적지 ${actual.stops.size}곳 · version ${actual.observationVersion}", style = MaterialTheme.typography.bodyMedium)
                    if (editingAllowed == true) actual.stops.forEach { Text(it.name, style = MaterialTheme.typography.bodyMedium) }
                    Text("경로 탐색 완료와 안내 활성화는 다릅니다. 관찰값은 여러 SDK 읽기의 결과이며 원자적 스냅샷이 아닙니다.", style = MaterialTheme.typography.bodyMedium)
                    HorizontalDivider()
                    Text("위치 ${loc.status} · ${loc.origin}", style = MaterialTheme.typography.titleMedium)
                    Text(loc.message, style = MaterialTheme.typography.bodyMedium)
                    if (editingAllowed == true) Text(fix?.let { "${it.coordinate.latitude}, ${it.coordinate.longitude} · ${it.origin} · 측정 ${it.measuredAtMillis ?: "미확인"}" } ?: "현재 위치 미확인", style = MaterialTheme.typography.bodyMedium)
                    Text("차량 ${vehicleState.origin} · gear=${vehicleState.gear} · focus=${vehicleState.audioFocusAllowed ?: "미확인"}", style = MaterialTheme.typography.bodyMedium)
                    HorizontalDivider()
                    Text("음성 ${speech.origin} · listening=${speech.listening} · speaking=${speech.speaking}", style = MaterialTheme.typography.titleMedium)
                    Text(speech.message, style = MaterialTheme.typography.bodyMedium)
                    if (editingAllowed != true) Text("플랫폼의 정차 편집 허용 상태가 확인되면 음성 시험을 할 수 있습니다.", style = MaterialTheme.typography.bodyMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(onClick = { action("stt_listen_requested") { voice.listen() } }, enabled = editingAllowed == true && microphoneGranted, modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("sdk-stt-listen")) { Text("STT 듣기") }
                        OutlinedButton(onClick = { chunkJob?.cancel(); record("voice_stop_requested"); voice.stop() }, modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("sdk-voice-stop")) { Text("음성 전체 중지") }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { ttsTest(false) }, enabled = editingAllowed == true, modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("sdk-tts-short")) { Text("짧은 TTS") }
                        OutlinedButton(onClick = { ttsTest(true) }, enabled = editingAllowed == true, modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("sdk-tts-chunks")) { Text("TTS 두 조각") }
                    }
                    OutlinedButton(onClick = { chunkJob?.cancel(); record("tts_interrupt_requested"); voice.interruptSpeech() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("sdk-tts-interrupt")) { Text("말하기만 중지 · STT 유지") }
                    if (editingAllowed == true && transcript.isNotBlank()) Text("현재 전사: $transcript", style = MaterialTheme.typography.bodyMedium)
                    Text("먼저 STT를 켠 뒤 TTS를 시작하면 동시 사용·끼어들기를 시험할 수 있습니다. 부분 전사는 반향일 수 있으며 onDone은 실제 청취의 증거가 아닙니다.", style = MaterialTheme.typography.bodyMedium)
                    feedback?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                    OutlinedButton(onClick = { exported.launch("carmeleon-pleos-sdk-${System.currentTimeMillis()}.json") }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("sdk-export")) { Text("진단 JSON 저장") }
                    if (editingAllowed == true) {
                        HorizontalDivider()
                        Text("실제 이벤트 · UTC / JSON의 elapsedMs는 단조 시계", style = MaterialTheme.typography.titleMedium)
                        lines.takeLast(60).forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
                    }
                }
            }
        }
    }

    override fun onStop() {
        chunkJob?.cancel()
        if (::voice.isInitialized) { record("activity_stopped"); voice.stop() }
        super.onStop()
    }

    override fun onDestroy() {
        if (::voice.isInitialized) voice.close()
        if (::navigation.isInitialized) navigation.close()
        if (::location.isInitialized) location.close()
        if (::vehicle.isInitialized) vehicle.close()
        if (::ux.isInitialized) ux.close()
        scope.cancel()
        super.onDestroy()
    }
}
