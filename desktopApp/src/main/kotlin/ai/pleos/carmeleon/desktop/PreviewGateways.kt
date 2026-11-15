package ai.pleos.carmeleon.desktop

import ai.pleos.carmeleon.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

/** Desktop-only simulator; no SDK or actual vehicle success is claimed. */
class PreviewNavigationGateway(private val scope: CoroutineScope) : NavigationGateway {
    private val mutableConnection = MutableStateFlow(ServiceConnection(origin = DataOrigin.PREVIEW))
    override val connection = mutableConnection.asStateFlow()
    private val mutableEvents = MutableSharedFlow<NavigationEvent>(extraBufferCapacity = 16)
    override val events = mutableEvents.asSharedFlow()
    private val mutableObserved = MutableStateFlow(ObservedGuidance(origin = DataOrigin.PREVIEW))
    override val observed = mutableObserved.asStateFlow()
    private var pending: Job? = null
    private var pendingId: String? = null
    private var activeRequestId: String? = null
    var failNext = false

    override suspend fun connect() {
        mutableConnection.value = ServiceConnection(ConnectionStatus.CONNECTED, "Windows 시연 서비스", DataOrigin.PREVIEW)
    }
    override suspend fun request(request: NavigationRequest) {
        request.validationError()?.let { mutableEvents.emit(NavigationEvent.Failed(request.requestId, it)); return }
        pending?.cancel()
        pendingId=request.requestId
        mutableEvents.emit(NavigationEvent.Requested(request.requestId))
        pending = scope.launch {
            delay(900)
            if (failNext) {
                failNext = false
                mutableEvents.emit(NavigationEvent.Failed(request.requestId, "시연: 내비게이션 요청 실패. 기존 경로를 유지합니다."))
            } else {
                activeRequestId = request.requestId
                mutableObserved.value = ObservedGuidance(GuidanceStatus.SIMULATION, request.waypoints + request.destination,
                    "preview-${request.requestId}", observedAtMillis = System.currentTimeMillis(), origin = DataOrigin.PREVIEW)
                mutableEvents.emit(NavigationEvent.Completed(request.requestId))
            }
            if(pendingId==request.requestId) pendingId=null
        }
    }
    override suspend fun cancel(requestId: String) {
        if(pendingId==requestId) {
            pending?.cancel(); pendingId=null
            mutableEvents.emit(NavigationEvent.Cancelled(requestId))
        }
    }
    fun arrive() { activeRequestId?.let { mutableEvents.tryEmit(NavigationEvent.DestinationArrived(it)) } }
    override fun close() { pending?.cancel(); pendingId=null; mutableConnection.value = ServiceConnection(message = "시연 서비스 해제", origin = DataOrigin.PREVIEW) }
}

class PreviewLocationGateway : LocationGateway {
    private val mutableConnection = MutableStateFlow(ServiceConnection(ConnectionStatus.CONNECTED, "예시 위치", DataOrigin.PREVIEW))
    override val connection = mutableConnection.asStateFlow()
    override val fixes = MutableStateFlow<LocationFix?>(LocationFix(Coordinate(37.2765,127.015), 30.0, DataOrigin.PREVIEW)).asStateFlow()
    override suspend fun connect() = Unit
    override fun close() = Unit
}

class PreviewVehicleGateway : VehicleGateway {
    private val mutable = MutableStateFlow(VehicleSnapshot(gear=Gear.DRIVE, audioFocusAllowed=true, batteryPercent=72, origin=DataOrigin.PREVIEW))
    override val state = mutable.asStateFlow()
    override suspend fun connect() = Unit
    fun setGear(gear: Gear) { mutable.value = mutable.value.copy(gear=gear) }
    fun setNavigationSpeaking(speaking: Boolean) { mutable.value=mutable.value.copy(navigationSpeaking=speaking) }
    override fun close() = Unit
}

class PreviewVoiceGateway : StreamingVoiceGateway {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var outputTurn: String? = null
    private var completion: Job? = null
    private val outputEvents = MutableSharedFlow<VoiceEvent>(extraBufferCapacity = 16)
    override val voiceEvents = outputEvents.asSharedFlow()
    override suspend fun speakChunk(turnId: String, text: String, isFinal: Boolean) {
        outputTurn = turnId
        mutable.value = mutable.value.copy(speaking = true, message = "음성 재생 시뮬레이션 · 실제 소리 없음")
        outputEvents.emit(VoiceEvent.PlaybackStarted(turnId))
        if (isFinal) {
            completion?.cancel()
            completion = scope.launch { delay(350); if (outputTurn == turnId) {
                outputTurn = null; mutable.value = mutable.value.copy(speaking = false)
                outputEvents.emit(VoiceEvent.PlaybackDone(turnId))
            } }
        }
    }
    override fun interruptSpeech() {
        completion?.cancel()
        outputTurn?.let { outputEvents.tryEmit(VoiceEvent.PlaybackStopped(it)) }
        outputTurn = null; mutable.value = mutable.value.copy(speaking = false)
    }
    private val mutable = MutableStateFlow(SpeechState(available=true,message="PC 텍스트 음성 시연",origin=DataOrigin.PREVIEW))
    override val state = mutable.asStateFlow()
    private val mutableTranscripts=MutableSharedFlow<String>(extraBufferCapacity=4)
    override val transcripts=mutableTranscripts.asSharedFlow()
    override suspend fun listen() { mutable.value=mutable.value.copy(message="시연 메뉴에서 발화를 선택하세요.") }
    override suspend fun speak(text:String) { mutable.value=mutable.value.copy(message="시연 발화: $text") }
    fun say(text:String) { mutableTranscripts.tryEmit(text) }
    override fun stop() { interruptSpeech(); mutable.value=mutable.value.copy(listening=false,speaking=false) }
    override fun close() { stop(); scope.cancel() }
}
