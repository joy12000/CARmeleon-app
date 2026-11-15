package ai.pleos.carmeleon.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.pleos.carmeleon.core.*
import kotlinx.coroutines.flow.Flow

/** Shared native vehicle surface. Durable operations stay with the conversation/path owners. */
@Composable
fun CarmeleonApp(
    controller: JourneyController,
    initialDark: Boolean = false,
    modifier: Modifier = Modifier,
    backRequests: Flow<Unit>? = null,
    onBackStateChanged: (Boolean) -> Unit = {},
    initialReducedMotion: Boolean = false,
    agent: AgentUiState = AgentUiState(),
    onAgentSubmit: (String) -> Unit = {},
    onAgentChoice: (String, Boolean) -> Unit = { _, _ -> },
    onAgentCancel: () -> Unit = {},
    onMicrophoneToggle: (() -> Unit)? = null,
    onMemorySave: (String) -> Unit = {},
    onMemoryUpdate: (String, String) -> Unit = { _, _ -> },
    onMemoryDelete: (String) -> Unit = {},
    onMaterialAdd: (String, String) -> Unit = { _, _ -> },
    onMaterialDelete: (String) -> Unit = {},
    onMaterialPick: () -> Unit = {},
    onRouteEdit: (List<RouteStop>) -> Unit = {},
    onAuthenticate: (String, String, Boolean) -> Unit = { _, _, _ -> },
    onLogout: () -> Unit = {},
    onSelectPath: (String) -> Unit = {},
    onStartPath: (String) -> Unit = { id -> onSelectPath(id); controller.start() },
    onCreatePath: (String) -> Unit = {},
    onRefresh: () -> Unit = {},
    onOpenNavigationSearch: (String) -> Unit = {},
    onOpenRouteOptions: () -> Unit = {},
    onOpenNavigationForeground: () -> Unit = {},
    onExportDiagnostics: () -> Unit = {},
    onOpenSdkDiagnostics: (() -> Unit)? = null,
) {
    val state by controller.state.collectAsState()
    var dark by remember { mutableStateOf(initialDark) }
    var panel by remember { mutableStateOf<String?>(null) }
    var reducedMotion by remember { mutableStateOf(initialReducedMotion) }
    var subtitles by remember { mutableStateOf(false) }
    val hasDecision = (state.proposalVisible && state.phase != JourneyPhase.CONFIRMED) || agent.choices.isNotEmpty()
    val canHandleBack = panel != null || hasDecision || state.isPending
    fun handleBack(): Boolean = when {
        panel != null -> { panel = null; true }
        state.isPending -> { controller.cancelPending(); true }
        state.proposalVisible -> { controller.dismissProposal(); true }
        agent.choices.isNotEmpty() -> { onAgentChoice(agent.choices.first().id, false); true }
        else -> false
    }
    val latestBack by rememberUpdatedState { handleBack() }
    SideEffect { onBackStateChanged(canHandleBack) }
    DisposableEffect(Unit) { onDispose { onBackStateChanged(false) } }
    LaunchedEffect(backRequests) { backRequests?.collect { latestBack() } }
    val waveState = agent.copy(phase = when {
        state.speech.listening -> AgentUiPhase.LISTENING
        state.speech.speaking -> AgentUiPhase.SPEAKING
        hasDecision -> AgentUiPhase.WAITING
        else -> agent.phase
    })
    CarmeleonTheme(dark) {
        val colors = LocalVehicleColors.current
        Surface(modifier.fillMaxSize().testTag("carmeleon-app").onPreviewKeyEvent {
            if (it.type == KeyEventType.KeyUp && it.key == Key.Escape) handleBack() else false
        }, color = colors.surface) {
            BoxWithConstraints {
                val containerWidth = maxWidth
                val containerHeight = maxHeight
                val compact = containerWidth < 760.dp
                val dualMode = containerWidth < 1080.dp
                Column(Modifier.fillMaxSize()) {
                    AppBar(state, dark, compact, dualMode, { panel = if (panel == "settings") null else "settings" }) { dark = !dark }
                    val journeyDecision = panel == null && state.proposalVisible && state.proposal != null && state.phase != JourneyPhase.CONFIRMED
                    val waveOnlyDual = dualMode && !journeyDecision && agent.choices.isEmpty() && (state.phase == JourneyPhase.DRIVING || state.phase == JourneyPhase.CONFIRMED)
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        if (dualMode) {
                            CompanionPanel(
                                state = state,
                                agent = waveState,
                                compact = compact,
                                reducedMotion = reducedMotion,
                                subtitles = subtitles,
                                modifier = Modifier.fillMaxSize(),
                                controller = controller,
                                tight = containerHeight < 720.dp,
                                onSettings = { panel = "settings" },
                                waveOnly = waveOnlyDual,
                                dualMode = true,
                                onOpenRoutePicker = { panel = "route" },
                            )
                        } else Row(Modifier.fillMaxSize()) {
                            CompanionPanel(state, waveState, false, reducedMotion, subtitles, Modifier.width((containerWidth * .29f).coerceIn(300.dp, 380.dp)).fillMaxHeight(), controller, containerHeight < 720.dp, { panel = "settings" })
                            RouteMap(state, false, Modifier.weight(1f).fillMaxHeight().clipToBounds())
                        }
                        androidx.compose.animation.AnimatedVisibility(journeyDecision, modifier = Modifier.align(Alignment.BottomEnd).padding(if (compact) 10.dp else 20.dp).widthIn(max = 470.dp), enter = fadeIn(tween(if (reducedMotion) 0 else 180)), exit = fadeOut(tween(if (reducedMotion) 0 else 120))) { JourneyDecision(state, controller) }
                        if (panel == null && !journeyDecision && agent.choices.isNotEmpty()) AgentDecision(agent.choices, onAgentChoice, Modifier.align(Alignment.BottomEnd).padding(if (compact) 10.dp else 20.dp).widthIn(max = 470.dp))
                        panel?.let { open ->
                            Surface(Modifier.align(Alignment.CenterEnd).padding(if (compact) 8.dp else 18.dp).widthIn(max = 490.dp).fillMaxHeight().testTag("management-panel"), shape = RoundedCornerShape(12.dp), color = colors.surface, shadowElevation = 10.dp) {
                                when (open) {
                                    "route" -> RouteEditor(state, agent, dualMode, { panel = null }, onRouteEdit, onSelectPath, onStartPath, onCreatePath, onOpenNavigationSearch, onOpenRouteOptions, onOpenNavigationForeground, controller::start)
                                    "text" -> ConversationInput(agent, { panel = null }, onAgentSubmit)
                                    "memory" -> MemoryPanel(agent, { panel = null }, onMemorySave, onMemoryUpdate, onMemoryDelete)
                                    "material" -> MaterialPanel(agent, { panel = null }, onMaterialAdd, onMaterialDelete, onMaterialPick)
                                    else -> SettingsPanel(state, agent, reducedMotion, { reducedMotion = it }, subtitles, { subtitles = it }, { panel = null }, { panel = "text" }, { panel = "memory" }, { panel = "material" }, controller, onAuthenticate, onLogout, onRefresh, onExportDiagnostics, onOpenSdkDiagnostics)
                                }
                            }
                        }
                    }
                    if (dualMode) {
                        DualDrivingDock(compact, panel, waveState, { panel = if (panel == it) null else it }, onMicrophoneToggle ?: controller::listen, onAgentCancel)
                    } else {
                        VehicleDock(compact, panel, waveState, { panel = if (panel == it) null else it }, onMicrophoneToggle ?: controller::listen, onAgentCancel)
                    }
                }
            }
        }
    }
}

internal fun poiIcon(kind: PoiKind?): ImageVector = when (kind) { PoiKind.CHARGER -> Icons.Outlined.EvStation; PoiKind.RESTROOM -> Icons.Outlined.Wc; else -> Icons.Outlined.Restaurant }
internal fun poiLabel(kind: PoiKind?): String = when (kind) { PoiKind.MEAL -> "식사"; PoiKind.CHARGER -> "충전"; PoiKind.RESTROOM -> "화장실"; null -> "경유" }
internal fun originLabel(origin: DataOrigin): String = when (origin) { DataOrigin.PREVIEW -> "시연 데이터"; DataOrigin.PLEOS -> "Pleos"; DataOrigin.BACKEND_SAMPLE -> "서버 예시"; DataOrigin.USER -> "사용자 경로" }
private fun hasTravelEstimate(route: JourneyRoute): Boolean = route.durationMinutes > 0 && route.distanceKm > 0
private fun arrivalLabel(route: JourneyRoute): String = if (hasTravelEstimate(route)) formatClock(route.arrivalMinuteOfDay) else "안내에서 확인"

@Composable
private fun AppBar(state: JourneyState, dark: Boolean, compact: Boolean, dualMode: Boolean, onSettings: () -> Unit, onTheme: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = if (compact) 14.dp else 24.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("carmeleon", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.weight(1f))
        if (state.connection.origin == DataOrigin.PREVIEW) Text("시연", style = MaterialTheme.typography.labelLarge, color = LocalVehicleColors.current.secondary, modifier = Modifier.testTag("preview-badge"))
        IconButton(onClick = onTheme, modifier = Modifier.testTag("theme-toggle")) { Icon(if (dark) Icons.Outlined.LightMode else Icons.Outlined.DarkMode, if (dark) "주간 화면" else "야간 화면") }
        if (dualMode) {
            IconButton(onClick = onSettings, modifier = Modifier.testTag("guidance-toggle")) { Icon(Icons.Outlined.Settings, "설정") }
        }
    }
}

@Composable
private fun CompanionPanel(
    state: JourneyState,
    agent: AgentUiState,
    compact: Boolean,
    reducedMotion: Boolean,
    subtitles: Boolean,
    modifier: Modifier,
    controller: JourneyController,
    tight: Boolean,
    onSettings: () -> Unit,
    waveOnly: Boolean = false,
    dualMode: Boolean = false,
    onOpenRoutePicker: () -> Unit = {},
) {
    val colors = LocalVehicleColors.current
    Column(modifier.background(colors.panel).padding(horizontal = if (compact) 20.dp else 28.dp, vertical = if (compact) 10.dp else if (tight) 16.dp else 24.dp)) {
        if (!compact || waveOnly || dualMode) Spacer(Modifier.weight(1f))
        AgentWave(agent, reducedMotion, Modifier.fillMaxWidth().height(if (waveOnly) 200.dp else if (compact) 100.dp else if (tight) 120.dp else 200.dp))
        if (agent.phase == AgentUiPhase.LISTENING) Row(Modifier.align(Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Outlined.Mic, null, Modifier.size(16.dp)); Text("듣는 중", style = MaterialTheme.typography.labelLarge)
        }
        val noticeText = if (waveOnly || dualMode) state.error ?: agent.notice?.takeIf { agent.phase == AgentUiPhase.ERROR } else state.error ?: agent.notice
        noticeText?.let { Text(it, color = if (state.error != null || agent.phase == AgentUiPhase.ERROR) MaterialTheme.colorScheme.error else colors.secondary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("agent-notice").padding(vertical = 8.dp), maxLines = 3, overflow = TextOverflow.Ellipsis) }
        if (agent.phase == AgentUiPhase.ERROR) TextButton(onClick = onSettings, modifier = Modifier.heightIn(min = 48.dp).align(Alignment.CenterHorizontally).testTag("agent-error-settings")) { Text("연결 설정 확인") }
        if (subtitles && agent.subtitle.isNotBlank()) Text(agent.subtitle, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("agent-subtitle").padding(vertical = 8.dp), maxLines = if (compact) 2 else 4, overflow = TextOverflow.Ellipsis)
        if (!compact || waveOnly || dualMode) Spacer(Modifier.weight(1f))
        if (waveOnly) return
        if (dualMode) {
            val subtitleHint = state.route.destination?.name?.let { dest ->
                if (state.route.title.isNotBlank() && state.route.title != dest) "${state.route.title} · $dest" else dest
            } ?: "목적지 경로를 불러와 안내를 시작하세요."
            Text(
                subtitleHint,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.secondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 12.dp),
            )
            if (state.isPending) {
                Button(
                    onClick = controller::cancelPending,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("cancel-pending"),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("내비게이션 연결 중 · 취소")
                }
            } else if (state.phase == JourneyPhase.FAILED) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilledTonalButton(
                        onClick = onOpenRoutePicker,
                        modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("call-routes"),
                        shape = RoundedCornerShape(8.dp),
                    ) { Text("경로 부르기") }
                    Button(
                        onClick = controller::retry,
                        modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("retry"),
                        shape = RoundedCornerShape(8.dp),
                    ) { Text("다시 시도") }
                }
            } else {
                Button(
                    onClick = onOpenRoutePicker,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp).testTag("call-routes"),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Icon(Icons.Outlined.Route, null, Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("경로 부르기", style = MaterialTheme.typography.titleMedium)
                }
            }
            return
        }
        if (compact) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(state.route.destination?.name ?: "목적지 없음", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(arrivalLabel(state.route), style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("arrival-time"))
        } else {
            Text(state.route.destination?.name ?: "목적지 없음", style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(12.dp))
            Text(arrivalLabel(state.route), style = if (hasTravelEstimate(state.route)) MaterialTheme.typography.headlineLarge else MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("arrival-time"))
            if (hasTravelEstimate(state.route)) Text("${state.route.durationMinutes}분 · ${state.route.distanceKm} km", style = MaterialTheme.typography.bodyMedium, color = colors.secondary, modifier = Modifier.padding(top = 4.dp))
        }
        if (state.phase == JourneyPhase.READY || state.phase == JourneyPhase.FAILED || state.isPending) {
            Spacer(Modifier.height(if (compact) 10.dp else 24.dp))
            Button(onClick = { if (state.isPending) controller.cancelPending() else if (state.phase == JourneyPhase.FAILED) controller.retry() else controller.start() }, enabled = state.isPending || state.route.isNavigable, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(if (state.isPending) "cancel-pending" else if (state.phase == JourneyPhase.FAILED) "retry" else "start"), shape = RoundedCornerShape(6.dp)) {
                if (state.isPending) { CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
                Text(if (state.isPending) "요청 취소" else if (state.phase == JourneyPhase.FAILED) "다시 시도" else "안내 시작")
            }
        }
    }
}

@Composable
private fun JourneyDecision(state: JourneyState, controller: JourneyController) {
    val proposal = state.proposal ?: return
    DecisionSurface("proposal-sheet") {
        Text(proposal.stop.name, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text("추가 ${proposal.extraDrivingMinutes}분 · 머무름 ${proposal.dwellMinutes}분 · ${formatClock(proposal.arrivalMinuteOfDay)} 도착", style = MaterialTheme.typography.bodyMedium)
        if (proposal.estimatesOnly) Text("시연·추정 시간", style = MaterialTheme.typography.labelLarge, color = LocalVehicleColors.current.secondary)
        if (state.error != null) Text(state.error, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        DecisionButtons("기존 경로 유지", if (state.isPending) "반영 중" else "이 경로로 변경", !state.isPending, controller::dismissProposal, { if (state.phase == JourneyPhase.FAILED) controller.retry() else controller.approveProposal() }, "reject-proposal", "approve")
    }
}

@Composable
private fun AgentDecision(choices: List<AgentChoiceUi>, onChoice: (String, Boolean) -> Unit, modifier: Modifier) {
    Box(modifier) {
        DecisionSurface("agent-choice") {
            choices.take(3).forEach { choice ->
                Text(choice.title, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (choice.detail.isNotBlank()) Text(choice.detail, style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
                DecisionButtons("취소", choice.approveLabel, true, { onChoice(choice.id, false) }, { onChoice(choice.id, true) }, "agent-reject-${choice.id}", "agent-approve-${choice.id}")
            }
        }
    }
}

@Composable
private fun DecisionSurface(tag: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth().testTag(tag), shape = RoundedCornerShape(12.dp), color = LocalVehicleColors.current.surface, shadowElevation = 10.dp) {
        Column(Modifier.padding(20.dp).heightIn(max = 490.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

@Composable
private fun DecisionButtons(cancel: String, apply: String, enabled: Boolean, onCancel: () -> Unit, onApply: () -> Unit, cancelTag: String, applyTag: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        FilledTonalButton(onClick = onCancel, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag(cancelTag), shape = RoundedCornerShape(6.dp), contentPadding = PaddingValues(8.dp)) { Text(cancel) }
        Button(onClick = onApply, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag(applyTag), shape = RoundedCornerShape(6.dp), contentPadding = PaddingValues(8.dp)) { Text(apply) }
    }
}

@Composable
private fun PanelHeader(title: String, closeTag: String = "close-panel", onClose: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        IconButton(onClick = onClose, modifier = Modifier.size(48.dp).testTag(closeTag)) { Icon(Icons.Outlined.Close, "$title 닫기") }
    }
}

@Composable
private fun RouteEditor(
    state: JourneyState,
    agent: AgentUiState,
    dualMode: Boolean,
    onClose: () -> Unit,
    onApply: (List<RouteStop>) -> Unit,
    onSelect: (String) -> Unit,
    onStartPath: (String) -> Unit,
    onCreate: (String) -> Unit,
    onSearch: (String) -> Unit,
    onOptions: () -> Unit,
    onForeground: () -> Unit,
    onStartCurrent: () -> Unit,
) {
    var stops by remember(state.route) { mutableStateOf(state.route.stops) }
    var editing by remember(state.route.id) { mutableStateOf(false) }
    var pathsOpen by remember { mutableStateOf(false) }
    var detailsOpen by remember(dualMode) { mutableStateOf(!dualMode) }
    var newTitle by remember { mutableStateOf("") }
    var search by remember { mutableStateOf("") }
    var draft by remember { mutableStateOf<RouteStop?>(null) }
    var latitude by remember { mutableStateOf("") }; var longitude by remember { mutableStateOf("") }
    var dwell by remember { mutableStateOf("0") }; var advanced by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun edit(stop: RouteStop) {
        draft = stop; latitude = stop.coordinate?.latitude?.toString().orEmpty(); longitude = stop.coordinate?.longitude?.toString().orEmpty(); dwell = stop.dwellMinutes.toString(); advanced = false; error = null
    }
    Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()).testTag("route-drawer"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PanelHeader(if (dualMode) "경로 부르기" else "경로", "close-route", onClose)
        if (dualMode) {
            Text("경로를 선택하면 Pleos 내비로 바로 전송해 안내를 시작합니다.", style = MaterialTheme.typography.bodyMedium, color = LocalVehicleColors.current.secondary)
            if (agent.connected && agent.paths.isNotEmpty()) {
                agent.paths.forEach { path ->
                    val selected = path.id == agent.activePathId
                    Surface(
                        onClick = { onStartPath(path.id); onClose() },
                        enabled = !agent.busy && !state.isPending,
                        modifier = Modifier.fillMaxWidth().testTag("pick-start-path-${path.id}"),
                        shape = RoundedCornerShape(10.dp),
                        color = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f) else LocalVehicleColors.current.panel,
                    ) {
                        Row(Modifier.padding(horizontal = 14.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Route, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
                            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                Text(path.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                if (path.stopSummary.isNotBlank()) {
                                    Text(path.stopSummary, style = MaterialTheme.typography.bodySmall, color = LocalVehicleColors.current.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            Text(if (selected) "다시 시작" else "내비 시작", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            } else if (state.route.isNavigable) {
                Surface(
                    onClick = { onStartCurrent(); onClose() },
                    enabled = !state.isPending,
                    modifier = Modifier.fillMaxWidth().testTag("start"),
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f),
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Route, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text(state.route.title.ifBlank { state.route.destination?.name ?: "현재 경로" }, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                state.route.stops.joinToString(" · ") { it.name }.ifBlank { state.route.destination?.name.orEmpty() },
                                style = MaterialTheme.typography.bodySmall,
                                color = LocalVehicleColors.current.secondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Text("내비 시작", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    }
                }
            } else {
                Text("휴대폰이나 설정에서 계정을 연결하면 저장된 경로 목록을 불러옵니다.", style = MaterialTheme.typography.bodyMedium, color = LocalVehicleColors.current.secondary)
            }
            if (agent.editable) {
                TextButton(onClick = { detailsOpen = !detailsOpen }, modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).testTag("route-details-toggle")) {
                    Text(if (detailsOpen) "세부 경로·편집 접기" else "세부 경로 보기 · 편집")
                }
            }
        }
        if (detailsOpen) {
        Text(state.route.title, style = MaterialTheme.typography.titleMedium)
        if (agent.connected) {
            TextButton(onClick = { pathsOpen = !pathsOpen }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("paths-toggle")) { Text(if (pathsOpen) "경로 목록 접기" else "다른 경로·새 경로") }
            if (pathsOpen) {
                agent.paths.forEach { path ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(path.title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        if (path.id == agent.activePathId) Icon(Icons.Outlined.Check, "현재 경로", Modifier.size(24.dp))
                        else TextButton(onClick = { onSelect(path.id); editing = false; draft = null }, enabled = agent.editable && !agent.busy && !state.isPending, modifier = Modifier.heightIn(min = 48.dp).testTag("select-path-${path.id}")) { Text("불러오기") }
                    }
                }
                if (agent.editable) {
                    EditorField("새 경로 이름", newTitle, { newTitle = it }, "new-path-title")
                    OutlinedButton(onClick = { onCreate(newTitle.trim()); newTitle = ""; editing = false; draft = null }, enabled = newTitle.isNotBlank() && !agent.busy && !state.isPending, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("create-path"), shape = RoundedCornerShape(6.dp)) { Text("새 경로 만들기") }
                }
                HorizontalDivider(color = LocalVehicleColors.current.divider)
            }
        }
        Text(state.route.departureName, style = MaterialTheme.typography.bodyMedium, color = LocalVehicleColors.current.secondary)
        if (stops.isEmpty()) Text("장소를 추가해 경로를 준비해 주세요.", style = MaterialTheme.typography.bodyMedium)
        stops.forEachIndexed { index, stop ->
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.LocationOn, null, Modifier.size(20.dp))
                Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                    Text(stop.name, style = MaterialTheme.typography.titleMedium)
                    if (stop.purpose.isNotBlank()) Text(stop.purpose, style = MaterialTheme.typography.bodyMedium)
                }
                if (editing && agent.editable) {
                    IconButton(onClick = { edit(stop) }, modifier = Modifier.size(48.dp).testTag("edit-stop-${stop.id}")) { Icon(Icons.Outlined.Edit, "${stop.name} 수정") }
                    IconButton(onClick = { stops = stops.toMutableList().also { val moved = it.removeAt(index); it.add(index - 1, moved) } }, enabled = index > 0, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.ArrowUpward, "${stop.name} 앞으로") }
                    IconButton(onClick = { stops = stops.filterIndexed { i, _ -> i != index }; if (draft?.id == stop.id) draft = null }, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.DeleteOutline, "${stop.name} 경로에서 빼기") }
                }
            }
            HorizontalDivider(color = LocalVehicleColors.current.divider)
        }
        if (!agent.editable) Text("경로 편집은 정차 후에 할 수 있어요.", style = MaterialTheme.typography.bodyMedium)
        else {
            if (!editing) OutlinedButton(onClick = { editing = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("edit-route"), shape = RoundedCornerShape(6.dp)) { Text("경로 편집") }
            else {
                if (draft == null) OutlinedButton(onClick = { edit(RouteStop("manual-${kotlin.random.Random.nextLong().toString(16)}", "", null)) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("add-route-stop"), shape = RoundedCornerShape(6.dp)) { Text("장소 추가") }
                draft?.let { stop ->
                    EditorField("장소 이름", stop.name, { draft = stop.copy(name = it) }, "route-place-name")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        EditorField("위도", latitude, { latitude = it }, "route-latitude", Modifier.weight(1f))
                        EditorField("경도", longitude, { longitude = it }, "route-longitude", Modifier.weight(1f))
                    }
                    EditorField("메모", stop.memo, { draft = stop.copy(memo = it) }, "route-stop-memo")
                    TextButton(onClick = { advanced = !advanced }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("stop-advanced")) { Text(if (advanced) "일정·자료 접기" else "일정·자료") }
                    if (advanced) {
                        EditorField("방문 목적", stop.purpose, { draft = stop.copy(purpose = it) }, "route-stop-purpose")
                        EditorField("머무는 시간 · 분", dwell, { dwell = it }, "route-stop-dwell")
                        EditorField("약속 시각", stop.appointmentAt.orEmpty(), { draft = stop.copy(appointmentAt = it.ifBlank { null }) }, "route-stop-appointment", placeholder = "2026-11-12T14:30:00+09:00")
                        EditorField("시간대", stop.timeZone.orEmpty(), { draft = stop.copy(timeZone = it.ifBlank { null }) }, "route-stop-timezone", placeholder = "Asia/Seoul")
                        if (agent.materials.isNotEmpty()) Text("연결할 자료", style = MaterialTheme.typography.titleMedium)
                        agent.materials.forEach { material ->
                            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(material.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                Checkbox(material.id in stop.materialIds, { checked -> draft = stop.copy(materialIds = if (checked) (stop.materialIds + material.id).distinct() else stop.materialIds - material.id) }, modifier = Modifier.semantics { contentDescription = "${material.name} 경로 연결" })
                            }
                        }
                    }
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { draft = null; error = null }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("편집 취소") }
                        FilledTonalButton(onClick = {
                            val lat = latitude.toDoubleOrNull(); val lon = longitude.toDoubleOrNull(); val point = if (lat != null && lon != null) Coordinate(lat, lon) else null
                            val minutes = dwell.toIntOrNull()
                            error = when {
                                stop.name.isBlank() || point?.isValid != true -> "장소 이름과 올바른 위도·경도를 입력해 주세요."
                                minutes == null || minutes !in 0..1440 -> "머무는 시간은 0~1440분으로 입력해 주세요."
                                stop.appointmentAt != null && !Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?(Z|[+-]\\d{2}:\\d{2})").matches(stop.appointmentAt) -> "약속 시각을 예시 형식으로 입력해 주세요."
                                stop.appointmentAt != null && stop.timeZone.isNullOrBlank() -> "약속 시각의 시간대를 입력해 주세요."
                                else -> null
                            }
                            if (error == null) {
                                val changed = stop.copy(name = stop.name.trim(), coordinate = point, dwellMinutes = minutes!!)
                                stops = if (stops.any { it.id == stop.id }) stops.map { if (it.id == stop.id) changed else it } else stops + changed
                                draft = null
                            }
                        }, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("save-stop-draft"), shape = RoundedCornerShape(6.dp)) { Text("장소 저장") }
                    }
                }
                Button(onClick = { onApply(stops); editing = false; onClose() }, enabled = draft == null && stops != state.route.stops && !state.isPending && !agent.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("apply-route-edit"), shape = RoundedCornerShape(6.dp)) { Text("변경 적용") }
            }
            HorizontalDivider(color = LocalVehicleColors.current.divider)
            EditorField("내비에서 찾을 장소", search, { search = it }, "navigation-search-query")
            OutlinedButton(onClick = { onSearch(search.trim()) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("navigation-search"), shape = RoundedCornerShape(6.dp)) { Text("내비에서 장소 찾기") }
            OutlinedButton(onClick = onOptions, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("navigation-route-options"), shape = RoundedCornerShape(6.dp)) { Text("내비 경로 옵션") }
            OutlinedButton(onClick = onForeground, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("navigation-foreground"), shape = RoundedCornerShape(6.dp)) { Text("내비 화면 바로 열기") }
        }
        Text(originLabel(state.route.origin), style = MaterialTheme.typography.labelLarge, color = LocalVehicleColors.current.secondary)
        }
    }
}

@Composable
private fun EditorField(label: String, value: String, onValue: (String) -> Unit, tag: String, modifier: Modifier = Modifier, placeholder: String = "") {
    OutlinedTextField(value, onValue, label = { Text(label) }, placeholder = { if (placeholder.isNotBlank()) Text(placeholder) }, modifier = modifier.fillMaxWidth().testTag(tag), singleLine = true)
}

@Composable
private fun ConversationInput(agent: AgentUiState, onClose: () -> Unit, onSubmit: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        PanelHeader("메시지", onClose = onClose)
        if (!agent.editable) Text("주행 중에는 음성으로 말해 주세요.", style = MaterialTheme.typography.bodyMedium)
        else {
            OutlinedTextField(text, { text = it }, label = { Text("하고 싶은 말") }, modifier = Modifier.fillMaxWidth().testTag("agent-text-input"), minLines = 3, maxLines = 7)
            Button(onClick = { onSubmit(text.trim()); text = ""; onClose() }, enabled = text.isNotBlank() && agent.connected && !agent.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("agent-send"), shape = RoundedCornerShape(6.dp)) { Text("보내기") }
            if (!agent.connected) Text("에이전트 서버 연결을 확인해 주세요.", style = MaterialTheme.typography.bodyMedium, color = LocalVehicleColors.current.secondary)
        }
    }
}

@Composable
private fun MemoryPanel(agent: AgentUiState, onClose: () -> Unit, onSave: (String) -> Unit, onUpdate: (String, String) -> Unit, onDelete: (String) -> Unit) {
    var text by remember { mutableStateOf("") }; var editingId by remember { mutableStateOf<String?>(null) }; var deleting by remember { mutableStateOf<AgentMemoryUi?>(null) }
    deleting?.let { memory -> DeleteConfirmation("이 기억을 삭제할까요?", { deleting = null }) { onDelete(memory.id); deleting = null } }
    Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PanelHeader("기억", onClose = onClose)
        if (agent.memories.isEmpty()) Text("저장된 기억이 없어요.", style = MaterialTheme.typography.bodyMedium, color = LocalVehicleColors.current.secondary)
        agent.memories.forEach { memory ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(memory.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                if (agent.editable) {
                    IconButton(onClick = { editingId = memory.id; text = memory.text }, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Edit, "기억 수정") }
                    IconButton(onClick = { deleting = memory }, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.DeleteOutline, "기억 삭제") }
                }
            }
            HorizontalDivider(color = LocalVehicleColors.current.divider)
        }
        if (agent.editable) {
            OutlinedTextField(text, { text = it }, label = { Text(if (editingId == null) "새 기억" else "기억 수정") }, modifier = Modifier.fillMaxWidth().testTag("memory-input"), minLines = 2)
            Button(onClick = { editingId?.let { onUpdate(it, text.trim()) } ?: onSave(text.trim()); text = ""; editingId = null }, enabled = agent.connected && !agent.busy && text.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("memory-save"), shape = RoundedCornerShape(6.dp)) { Text("저장") }
        }
    }
}

@Composable
private fun MaterialPanel(agent: AgentUiState, onClose: () -> Unit, onAdd: (String, String) -> Unit, onDelete: (String) -> Unit, onPick: () -> Unit) {
    var name by remember { mutableStateOf("") }; var content by remember { mutableStateOf("") }; var deleting by remember { mutableStateOf<AgentMaterialUi?>(null) }
    deleting?.let { material -> DeleteConfirmation("${material.name} 자료를 삭제할까요?", { deleting = null }) { onDelete(material.id); deleting = null } }
    Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PanelHeader("경로 자료", onClose = onClose)
        agent.materials.forEach { material ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text(material.name, style = MaterialTheme.typography.titleMedium); Text(material.status, style = MaterialTheme.typography.bodyMedium, color = LocalVehicleColors.current.secondary) }
                if (agent.editable) IconButton(onClick = { deleting = material }, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.DeleteOutline, "${material.name} 삭제") }
            }
            HorizontalDivider(color = LocalVehicleColors.current.divider)
        }
        if (agent.editable) {
            OutlinedButton(onClick = onPick, enabled = agent.connected && !agent.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("material-pick"), shape = RoundedCornerShape(6.dp)) { Text("파일 첨부") }
            OutlinedTextField(name, { name = it }, label = { Text("자료 이름") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(content, { content = it }, label = { Text("자료 내용 붙여넣기") }, modifier = Modifier.fillMaxWidth(), minLines = 5, maxLines = 10)
            Button(onClick = { onAdd(name.trim(), content); name = ""; content = "" }, enabled = agent.connected && !agent.busy && name.isNotBlank() && content.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("material-save"), shape = RoundedCornerShape(6.dp)) { Text("이 경로에 저장") }
        }
    }
}

@Composable
private fun DeleteConfirmation(title: String, dismiss: () -> Unit, confirm: () -> Unit) {
    AlertDialog(onDismissRequest = dismiss, title = { Text(title) }, confirmButton = { TextButton(onClick = confirm, modifier = Modifier.heightIn(min = 48.dp).testTag("confirm-delete")) { Text("삭제") } }, dismissButton = { TextButton(onClick = dismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("취소") } })
}

@Composable
private fun SettingsPanel(state: JourneyState, agent: AgentUiState, reducedMotion: Boolean, onMotion: (Boolean) -> Unit, subtitles: Boolean, onSubtitles: (Boolean) -> Unit, onClose: () -> Unit, onTextInput: () -> Unit, onMemories: () -> Unit, onMaterials: () -> Unit, controller: JourneyController, onAuthenticate: (String, String, Boolean) -> Unit, onLogout: () -> Unit, onRefresh: () -> Unit, onExportDiagnostics: () -> Unit, onOpenSdkDiagnostics: (() -> Unit)?) {
    var email by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var registering by remember { mutableStateOf(false) }
    Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()).testTag("guidance-panel"), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        PanelHeader("설정", onClose = onClose)
        if (agent.phase == AgentUiPhase.ERROR && !agent.notice.isNullOrBlank()) Text(agent.notice, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        SettingSwitch("대화 자막", subtitles, onSubtitles, "show-subtitles")
        SettingSwitch("화면 움직임 줄이기", reducedMotion, onMotion, "reduce-motion")
        HorizontalDivider(color = LocalVehicleColors.current.divider)
        if (agent.accountEmail != null) {
            Text(agent.accountEmail, style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RoundedCornerShape(6.dp)) { Text("로그아웃") }
        } else if (agent.editable) {
            OutlinedTextField(email, { email = it }, label = { Text("이메일") }, modifier = Modifier.fillMaxWidth().testTag("account-email"), singleLine = true)
            OutlinedTextField(password, { password = it }, label = { Text(if (registering) "비밀번호 · 12자 이상" else "비밀번호") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().testTag("account-password"), singleLine = true)
            Button(onClick = { onAuthenticate(email.trim(), password, registering); password = "" }, enabled = email.contains('@') && password.isNotBlank() && (!registering || password.length >= 12) && !agent.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("account-submit"), shape = RoundedCornerShape(6.dp)) { Text(if (agent.busy) "연결 중" else if (registering) "가입" else "로그인") }
            TextButton(onClick = { registering = !registering }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (registering) "계정이 있어요 · 로그인" else "새 계정 만들기") }
        }
        HorizontalDivider(color = LocalVehicleColors.current.divider)
        OutlinedButton(onClick = onRefresh, enabled = agent.connected && !agent.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("agent-refresh"), shape = RoundedCornerShape(6.dp)) { Icon(Icons.Outlined.Sync, null, Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)); Text("동기화 새로고침") }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onTextInput, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("settings-open-input"), shape = RoundedCornerShape(6.dp)) { Text("텍스트 입력") }
            OutlinedButton(onClick = onMemories, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("settings-open-memory"), shape = RoundedCornerShape(6.dp)) { Text("기억") }
        }
        OutlinedButton(onClick = onMaterials, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("materials-open"), shape = RoundedCornerShape(6.dp)) { Icon(Icons.Outlined.Description, null, Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)); Text("경로 자료") }
        Text(state.connection.message, style = MaterialTheme.typography.bodyMedium)
        Text(state.backend.message, style = MaterialTheme.typography.bodyMedium)
        Text(state.speech.message, style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = onExportDiagnostics, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("export-diagnostics"), shape = RoundedCornerShape(6.dp)) { Text("진단 기록 내보내기") }
        onOpenSdkDiagnostics?.let { open -> OutlinedButton(onClick = open, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("sdk-diagnostics-open"), shape = RoundedCornerShape(6.dp)) { Text("Pleos SDK 확인") } }
        state.vehicle.speechHoldReason?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        if (state.connection.status != ConnectionStatus.CONNECTED) OutlinedButton(onClick = controller::connect, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("reconnect"), shape = RoundedCornerShape(6.dp)) { Text("차량 연결 다시 확인") }
    }
}

@Composable
private fun SettingSwitch(label: String, checked: Boolean, onChange: (Boolean) -> Unit, tag: String) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) { Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f)); Switch(checked, onChange, modifier = Modifier.testTag(tag).semantics { contentDescription = label }) }
}

@Composable
private fun DualDrivingDock(compact: Boolean, panel: String?, agent: AgentUiState, onPanel: (String) -> Unit, onListen: () -> Unit, onStop: () -> Unit) {
    val colors = LocalVehicleColors.current
    val speaking = agent.phase == AgentUiPhase.SPEAKING || agent.phase == AgentUiPhase.THINKING
    val listening = agent.phase == AgentUiPhase.LISTENING
    Row(
        Modifier.fillMaxWidth().height(if (compact) 68.dp else 74.dp).background(colors.dock).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
    ) {
        DockButton(
            icon = if (speaking) Icons.Outlined.StopCircle else if (listening) Icons.Outlined.MicOff else Icons.Outlined.Mic,
            label = if (speaking) "중지" else if (listening) "듣는 중" else "마이크",
            selected = listening,
            tag = if (speaking) "agent-stop" else if (listening) "mic-off" else "listen",
            compact = false,
            onClick = if (speaking) onStop else onListen,
        )
        DockButton(
            icon = Icons.Outlined.Route,
            label = "경로 재선택",
            selected = panel == "route",
            tag = "route-toggle",
            compact = false,
            onClick = { onPanel("route") },
        )
    }
}

@Composable
private fun VehicleDock(compact: Boolean, panel: String?, agent: AgentUiState, onPanel: (String) -> Unit, onListen: () -> Unit, onStop: () -> Unit) {
    val colors = LocalVehicleColors.current
    Row(Modifier.fillMaxWidth().height(if (compact) 66.dp else 74.dp).background(colors.dock).padding(horizontal = if (compact) 4.dp else 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        if (!compact) { Text("CARmeleon", style = MaterialTheme.typography.titleSmall, color = Color.White, modifier = Modifier.width(140.dp)); Spacer(Modifier.weight(1f)) }
        DockButton(Icons.Outlined.Route, "경로", panel == "route", "route-toggle", compact) { onPanel("route") }
        val speaking = agent.phase == AgentUiPhase.SPEAKING || agent.phase == AgentUiPhase.THINKING
        val listening = agent.phase == AgentUiPhase.LISTENING
        DockButton(if (speaking) Icons.Outlined.StopCircle else if (listening) Icons.Outlined.MicOff else Icons.Outlined.Mic, if (speaking) "중지" else if (listening) "끄기" else "말하기", listening, if (speaking) "agent-stop" else if (listening) "mic-off" else "listen", compact, if (speaking) onStop else onListen)
        DockButton(Icons.Outlined.Keyboard, "입력", panel == "text", "agent-input-open", compact) { onPanel("text") }
        DockButton(Icons.Outlined.BookmarkBorder, "기억", panel == "memory", "memory-open", compact) { onPanel("memory") }
        DockButton(Icons.Outlined.Settings, "설정", panel == "settings", "guidance-toggle", compact) { onPanel("settings") }
        if (!compact) Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun DockButton(icon: ImageVector, label: String, selected: Boolean, tag: String, compact: Boolean, onClick: () -> Unit) {
    val colors = LocalVehicleColors.current
    TextButton(onClick, modifier = Modifier.height(56.dp).widthIn(min = if (compact) 66.dp else 88.dp).testTag(tag), shape = RoundedCornerShape(6.dp), contentPadding = PaddingValues(horizontal = if (compact) 6.dp else 12.dp, vertical = 4.dp), colors = ButtonDefaults.textButtonColors(containerColor = if (selected) colors.dockSelected else Color.Transparent, contentColor = if (selected) Color.White else colors.dockText)) {
        if (compact) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) { Icon(icon, null, Modifier.size(21.dp)); Text(label, style = MaterialTheme.typography.labelLarge) }
        else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(icon, null, Modifier.size(22.dp)); Text(label, style = MaterialTheme.typography.labelLarge) }
    }
}
