package ai.pleos.carmeleon.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/** A quiet ribbon, not a fabricated spectrogram. Measured levels are optional and explicit. */
@Composable
internal fun AgentWave(state: AgentUiState, reducedMotion: Boolean, modifier: Modifier = Modifier) {
    val colors = LocalVehicleColors.current
    val active = state.phase == AgentUiPhase.LISTENING || state.phase == AgentUiPhase.SPEAKING
    val measured = when (state.phase) {
        AgentUiPhase.LISTENING -> state.inputLevel
        AgentUiPhase.SPEAKING -> state.outputLevel
        else -> null
    }?.coerceIn(0f, 1f)
    val phase = if (reducedMotion) 0f else {
        val transition = rememberInfiniteTransition(label = "agent-ribbon")
        val motion by transition.animateFloat(
            initialValue = 0f,
            targetValue = (2 * PI).toFloat(),
            animationSpec = infiniteRepeatable(tween(if (active) 3600 else 7200, easing = LinearEasing)),
            label = "ribbon-phase",
        )
        motion
    }
    val description = when (state.phase) {
        AgentUiPhase.IDLE -> "AI 대기 중"
        AgentUiPhase.LISTENING -> "마이크로 듣는 중"
        AgentUiPhase.THINKING -> "AI 응답 준비 중"
        AgentUiPhase.SPEAKING -> "AI 음성 재생 중"
        AgentUiPhase.WAITING -> "사용자 선택 대기 중"
        AgentUiPhase.HELD -> "음성 안내 보류 중"
        AgentUiPhase.ERROR -> "AI 연결 확인 필요"
    }
    Canvas(modifier.testTag("agent-wave").semantics { contentDescription = description }) {
        val center = size.height / 2
        val amplitude = size.height * (if (reducedMotion) .12f else .16f + (measured ?: 0f) * .22f)
        repeat(7) { ribbon ->
            val path = Path()
            for (step in 0..150) {
                val t = step / 150f
                val envelope = exp(-((t - .5f) * 3.8f) * ((t - .5f) * 3.8f))
                val spread = (ribbon - 3) * .18f
                val pulse = sin(t * PI * 3 + phase + spread).toFloat() * .78f +
                    sin(t * PI * 5 - phase * .5f + spread * 2).toFloat() * .22f
                val y = center + amplitude * envelope * pulse + (ribbon - 3) * size.height * .022f * envelope
                if (step == 0) path.moveTo(0f, y) else path.lineTo(t * size.width, y)
            }
            drawPath(path, if (ribbon == 3) colors.ink else colors.ink.copy(alpha = .16f + ribbon * .07f), style = Stroke(width = (if (ribbon == 3) 2.2.dp else 1.2.dp).toPx(), cap = StrokeCap.Round))
        }
    }
}
