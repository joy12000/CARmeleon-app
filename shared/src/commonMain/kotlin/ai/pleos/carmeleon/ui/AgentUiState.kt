package ai.pleos.carmeleon.ui

/** UI projection only. The conversation/path owners decide whether an action is available. */
enum class AgentUiPhase { IDLE, LISTENING, THINKING, SPEAKING, WAITING, HELD, ERROR }

data class AgentChoiceUi(
    val id: String,
    val title: String,
    val detail: String = "",
    val approveLabel: String = "변경 적용",
)

data class AgentMemoryUi(val id: String, val text: String)
data class AgentMaterialUi(val id: String, val name: String, val status: String)
data class AgentPathUi(val id: String, val title: String, val stopSummary: String = "")

data class AgentUiState(
    val connected: Boolean = false,
    val phase: AgentUiPhase = AgentUiPhase.IDLE,
    val subtitle: String = "",
    val notice: String? = null,
    /** Null means no measured audio level; the wave remains an ambient state animation. */
    val inputLevel: Float? = null,
    val outputLevel: Float? = null,
    val choices: List<AgentChoiceUi> = emptyList(),
    val memories: List<AgentMemoryUi> = emptyList(),
    val materials: List<AgentMaterialUi> = emptyList(),
    /** Platform UX restrictions, not merely the selected gear. Preview explicitly permits editing. */
    val editable: Boolean = true,
    val accountEmail: String? = null,
    val busy: Boolean = false,
    val paths: List<AgentPathUi> = emptyList(),
    val activePathId: String? = null,
)
