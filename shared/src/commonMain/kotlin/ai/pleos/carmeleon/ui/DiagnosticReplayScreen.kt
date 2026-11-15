package ai.pleos.carmeleon.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** Read-only trace playback; no service call, driver control or audio output. */
data class DiagnosticReplayEvent(val at: String, val event: String, val status: String = "")

@Composable
fun DiagnosticReplayScreen(events: List<DiagnosticReplayEvent>) {
    var index by remember(events) { mutableStateOf(0) }
    var playing by remember { mutableStateOf(false) }
    LaunchedEffect(playing, index, events) {
        if (playing && index < events.lastIndex) { delay(700); index++ }
        else if (index >= events.lastIndex) playing = false
    }
    val item = events.getOrNull(index)
    val phase = events.take(index + 1).fold(AgentUiPhase.IDLE) { previous, event -> when {
        event.event == "turn.requested" -> AgentUiPhase.THINKING
        event.event == "tts.onStart" || event.event == "voice.PlaybackStarted" -> AgentUiPhase.SPEAKING
        event.event.contains("PlaybackDone") -> AgentUiPhase.IDLE
        event.event.contains("Interrupt") || event.event.contains("PlaybackStopped") || event.event == "turn.local_interrupt" -> AgentUiPhase.LISTENING
        event.event == "turn.error" -> AgentUiPhase.ERROR
        else -> previous
    } }
    CarmeleonTheme(false) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.padding(28.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Text("진단 사건 재생", style = MaterialTheme.typography.headlineSmall)
                Text("기록된 상태를 다시 봅니다. SDK·음성은 실행하지 않습니다.", style = MaterialTheme.typography.bodyMedium)
                AgentWave(AgentUiState(phase = phase), true, Modifier.fillMaxWidth().height(160.dp))
                Text(item?.at ?: "기록 없음", style = MaterialTheme.typography.bodyMedium)
                Text(item?.event ?: "재생할 사건이 없습니다.", style = MaterialTheme.typography.titleMedium)
                if (!item?.status.isNullOrBlank()) Text(item!!.status, style = MaterialTheme.typography.bodyMedium)
                Slider(index.toFloat(), { index = it.toInt(); playing = false }, valueRange = 0f..events.lastIndex.coerceAtLeast(1).toFloat(), enabled = events.size > 1)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton({ index = (index - 1).coerceAtLeast(0); playing = false }, enabled = index > 0, modifier = Modifier.heightIn(min = 48.dp)) { Text("이전") }
                    Button({ if (index >= events.lastIndex) index = 0; playing = !playing }, enabled = events.isNotEmpty(), modifier = Modifier.heightIn(min = 48.dp)) { Text(if (playing) "멈춤" else "순서대로 보기") }
                    OutlinedButton({ index = (index + 1).coerceAtMost(events.lastIndex); playing = false }, enabled = index < events.lastIndex, modifier = Modifier.heightIn(min = 48.dp)) { Text("다음") }
                }
                Text("${if (events.isEmpty()) 0 else index + 1} / ${events.size} · 화면 재생 간격 0.7초", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
