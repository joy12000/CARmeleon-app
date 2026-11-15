package ai.pleos.carmeleon.pleos

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import ai.pleos.carmeleon.core.DataOrigin
import ai.pleos.carmeleon.core.SpeechState
import ai.pleos.carmeleon.core.StreamingVoiceGateway
import ai.pleos.carmeleon.core.VoiceEvent
import ai.pleos.playground.stt.SpeechToText
import ai.pleos.playground.stt.constant.ErrorType as SttError
import ai.pleos.playground.stt.constant.Mode as SttMode
import ai.pleos.playground.stt.listener.OnInitializeListener as SttInitializeListener
import ai.pleos.playground.stt.listener.ResultListener
import ai.pleos.playground.tts.TextToSpeech
import ai.pleos.playground.tts.constant.ErrorType as TtsError
import ai.pleos.playground.tts.constant.Mode as TtsMode
import ai.pleos.playground.tts.listener.EventListener
import ai.pleos.playground.tts.listener.OnInitializeListener as TtsInitializeListener
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.Locale

/** Pleos ON_DEVICE engines: no fabricated project credentials, browser speech, or implicit cloud fallback. */
class PleosVoiceGateway(
    context: Context,
    private val microphonePermissionGranted: () -> Boolean,
    private val onAudioFocusChanged: (Boolean?) -> Unit = {},
) : StreamingVoiceGateway {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutableState = MutableStateFlow(SpeechState(message = "Pleos 음성 연결 전", origin = DataOrigin.PLEOS))
    private val mutableTranscripts = MutableSharedFlow<String>(extraBufferCapacity = 8)
    override val state = mutableState.asStateFlow()
    override val transcripts = mutableTranscripts.asSharedFlow()
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var stt: SpeechToText? = null
    private var tts: TextToSpeech? = null
    private var sttReady = false
    private var ttsReady = false
    private var pendingListen = false
    private data class Chunk(val text: String, val final: Boolean)
    private val chunks = ArrayDeque<Chunk>()
    private var outputTurn: String? = null
    private var outputGeneration = 0L
    private var activeTtsListener: EventListener? = null
    private var conversationListening = false
    private data class RetiringOutput(val instance: TextToSpeech, val listener: EventListener?, val turnId: String,
        val done: CompletableDeferred<Boolean> = CompletableDeferred())
    private var retiring: RetiringOutput? = null
    private var stopUnconfirmed = false
    private val mutableVoiceEvents = MutableSharedFlow<VoiceEvent>(extraBufferCapacity = 32)
    override val voiceEvents = mutableVoiceEvents.asSharedFlow()
    @Volatile private var closed = false
    private var focusHeld = false
    private var focusLease: Job? = null
    private var sttTimeout: Job? = null
    private var ttsTimeout: Job? = null
    private val audioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANT)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(audioAttributes)
        .setAcceptsDelayedFocusGain(false)
        .setWillPauseWhenDucked(true)
        .setOnAudioFocusChangeListener({ change ->
            if (!closed) {
                if (change == AudioManager.AUDIOFOCUS_GAIN) {
                    focusHeld = true; onAudioFocusChanged(true)
                } else if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                    focusHeld = false; onAudioFocusChanged(false)
                    pendingListen = false; conversationListening = false
                    interruptSpeech()
                    runCatching { stt?.stop() }
                    mutableState.update { it.copy(listening = false, speaking = false, message = "다른 오디오 안내가 우선이라 잠시 멈췄습니다.") }
                }
            }
        }, Handler(Looper.getMainLooper())).build()

    private val resultListener = object : ResultListener {
        override fun onUpdated(text: String, isFinal: Boolean) {
            if (closed || text.isBlank()) return
            if (!isFinal) {
                mutableVoiceEvents.tryEmit(VoiceEvent.Partial(text.trim()))
                if (mutableState.value.speaking) {
                    mutableVoiceEvents.tryEmit(VoiceEvent.SpeechDetected("partial-transcript; echo rejection requires emulator validation"))
                    interruptSpeech()
                }
            } else mutableTranscripts.tryEmit(text.trim())
        }
        override fun onStartedRecognition() { if (!closed) mutableState.update { it.copy(available = true, listening = true, message = "듣고 있어요") } }
        override fun onEndedRecognition() {
            if (!closed) {
                mutableState.update { it.copy(listening = false) }
                // Recognition sessions may end after each final result. Keep only a user-started foreground session open.
                if (conversationListening && focusHeld) scope.launch { delay(200); if (!closed && conversationListening && focusHeld) requestListening() }
            }
        }
        override fun onError(errorType: SttError) {
            if (!closed) { mutableState.update { it.copy(listening = false, message = "Pleos 음성 인식 오류: ${errorType.name}") }; abandonFocus() }
        }
        override fun onReady() { if (!closed) mutableState.update { it.copy(available = true) } }
        override fun onUpdatedEpdData(epdOn: Long, epdOff: Long) = Unit
        override fun onUpdatedRms(rms: Double) = Unit
    }
    /** Each output turn gets its own SDK instance/listener. Old ID-less callbacks cannot acknowledge a new turn. */
    private fun createTtsListener(instance: TextToSpeech, generation: Long) = object : EventListener {
        private fun current() = !closed && tts === instance && generation == outputGeneration
        override fun onStart() { if (current()) {
            mutableState.update { it.copy(available = true, speaking = true, message = "안내 중") }
            outputTurn?.let { mutableVoiceEvents.tryEmit(VoiceEvent.PlaybackStarted(it)) }
        } }
        override fun onReady() { if (current()) mutableState.update { it.copy(available = true) } }
        override fun onDone() {
            if (retiring?.instance === instance) { finishRetirement(instance); return }
            if (current()) {
            outputTurn?.let { mutableVoiceEvents.tryEmit(VoiceEvent.PlaybackDone(it)) }
            outputTurn = null
            mutableState.update { it.copy(speaking = false, message = "안내를 마쳤습니다.") }
            if (!conversationListening) abandonFocus()
        } }
        override fun onStop() {
            if (retiring?.instance === instance) { finishRetirement(instance); return }
            if (current()) mutableState.update { it.copy(speaking = false) }
        }
        override fun onError(errorType: TtsError) { if (current()) voiceFailure("Pleos 음성 합성 오류: ${errorType.name}") }
        override fun onUpdatedRms(rms: Double) = Unit
    }

    override suspend fun prepare(): Boolean = withContext(Dispatchers.Main.immediate) {
        if (closed) return@withContext false
        if (!focusHeld) {
            focusHeld = runCatching { audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED }.getOrDefault(false)
            onAudioFocusChanged(focusHeld)
        }
        if (!focusHeld) mutableState.update { it.copy(message = "다른 오디오가 우선이라 음성 안내를 보류합니다.") }
        else armFocusLease(30_000)
        focusHeld
    }

    override suspend fun listen() = withContext(Dispatchers.Main.immediate) {
        if (closed) return@withContext
        if (!microphonePermissionGranted()) {
            mutableState.update { it.copy(listening = false, message = "음성을 사용하려면 마이크 권한을 허용해 주세요.") }
            return@withContext
        }
        if (!prepare()) return@withContext
        if (stopUnconfirmed && retiring == null) stopUnconfirmed = false // Explicit new user session after the old instance was released.
        conversationListening = true
        pendingListen = true
        if (sttReady) requestListening() else initializeStt()
    }

    private fun initializeStt() {
        if (stt != null) return
        try {
            val instance = SpeechToText(appContext, SttMode.ON_DEVICE)
            stt = instance
            mutableState.update { it.copy(message = "Pleos 음성 인식 연결 중") }
            sttTimeout = scope.launch { delay(15_000); if (!closed && !sttReady) voiceFailure("차량 음성 인식 서비스에 연결하지 못했습니다.") }
            instance.initialize(object : SttInitializeListener {
                override fun onSuccess() { scope.launch {
                    if (closed || stt !== instance) return@launch
                    sttTimeout?.cancel(); sttReady = true
                    instance.addListener(resultListener); instance.setLocale(Locale.KOREAN)
                    mutableState.update { it.copy(available = true, message = "Pleos 음성 인식 준비됨") }
                    if (pendingListen && focusHeld && microphonePermissionGranted()) requestListening()
                } }
                override fun onFailure(errorType: SttError) { scope.launch { if (!closed && stt === instance) voiceFailure("음성 인식 연결 실패: ${errorType.name}") } }
            })
        } catch (error: Exception) { voiceFailure("음성 인식 초기화 실패: ${error.message.orEmpty()}") }
    }

    private fun requestListening() {
        pendingListen = false
        try { stt?.request() }
        catch (error: Exception) { voiceFailure("음성 인식을 시작하지 못했습니다: ${error.message.orEmpty()}") }
    }

    override suspend fun speak(text: String) = speakChunk("local-${System.nanoTime()}", text, true)

    override suspend fun speakChunk(turnId: String, text: String, isFinal: Boolean) = withContext(Dispatchers.Main.immediate) {
        if (closed || (text.isBlank() && !isFinal) || !prepare()) return@withContext
        if (outputTurn != turnId) {
            retireTts()
            val boundary = retiring?.done
            if (boundary != null && !boundary.await()) return@withContext
            if (closed || stopUnconfirmed) return@withContext
            outputTurn = turnId
        }
        if (chunks.size >= 12) { voiceFailure("음성 대기열이 길어 안내를 중단했습니다."); return@withContext }
        chunks.addLast(Chunk(text, isFinal))
        // Do not stop STT here. Simultaneous service access and acoustic echo rejection remain final-test requirements.
        if (ttsReady) playSpeech() else initializeTts()
    }

    override fun interruptSpeech() {
        val interrupted = outputTurn
        retireTts() // Immediate local stop and generation invalidation, before server cancellation.
        if (interrupted != null) mutableVoiceEvents.tryEmit(VoiceEvent.PlaybackInterrupted(interrupted))
        mutableState.update { it.copy(speaking = false) }
    }

    private fun retireTts() {
        val previousTurn = outputTurn
        ++outputGeneration; chunks.clear(); outputTurn = null
        ttsTimeout?.cancel()
        val old = tts; tts = null; ttsReady = false
        val listener = activeTtsListener; activeTtsListener = null
        if (old == null) return
        if (previousTurn != null && listener != null) {
            val boundary = RetiringOutput(old, listener, previousTurn)
            retiring = boundary
            runCatching { old.stop() }.onFailure { boundary.done.complete(false); stopUnconfirmed = true }
            scope.launch {
                delay(3_000)
                if (retiring === boundary) {
                    retiring = null; stopUnconfirmed = true
                    runCatching { old.removeEventListener(listener) }; runCatching { old.release() }
                    boundary.done.complete(false)
                    mutableVoiceEvents.tryEmit(VoiceEvent.Unavailable("음성 중지 확인이 없어 자동 재생을 보류합니다. 음성 서비스를 다시 연결해 주세요."))
                }
            }
        } else {
            listener?.let { runCatching { old.removeEventListener(it) } }
            runCatching { old.stop() }; runCatching { old.release() }
        }
    }
    private fun finishRetirement(instance: TextToSpeech) {
        val boundary = retiring?.takeIf { it.instance === instance } ?: return
        retiring = null; stopUnconfirmed = false
        boundary.listener?.let { runCatching { instance.removeEventListener(it) } }
        runCatching { instance.release() }
        boundary.done.complete(true)
        mutableVoiceEvents.tryEmit(VoiceEvent.PlaybackStopped(boundary.turnId))
    }

    private fun initializeTts() {
        if (tts != null) return
        try {
            val instance = TextToSpeech(appContext, TtsMode.ON_DEVICE)
            tts = instance
            val generation = outputGeneration
            val eventListener = createTtsListener(instance, generation)
            activeTtsListener = eventListener
            mutableState.update { it.copy(message = "Pleos 음성 안내 연결 중") }
            ttsTimeout = scope.launch { delay(15_000); if (!closed && !ttsReady) voiceFailure("차량 음성 안내 서비스에 연결하지 못했습니다.") }
            instance.initialize(object : TtsInitializeListener {
                override fun onSuccess() { scope.launch {
                    if (closed || tts !== instance) return@launch
                    ttsTimeout?.cancel(); ttsReady = true
                    instance.addEventListener(eventListener); instance.setLocale(Locale.KOREAN); instance.setAudioAttributes(audioAttributes)
                    mutableState.update { it.copy(available = true, message = "Pleos 음성 안내 준비됨") }
                    if (chunks.isNotEmpty() && focusHeld) playSpeech()
                } }
                override fun onFailure(errorType: TtsError) { scope.launch { if (!closed && tts === instance) voiceFailure("음성 안내 연결 실패: ${errorType.name}") } }
            })
        } catch (error: Exception) { voiceFailure("음성 안내 초기화 실패: ${error.message.orEmpty()}") }
    }

    private fun playSpeech() {
        try {
            while (chunks.isNotEmpty()) {
                val chunk = chunks.removeFirst()
                tts?.speak(chunk.text, chunk.final)
            }
        } catch (error: Exception) { voiceFailure("음성 안내를 시작하지 못했습니다: ${error.message.orEmpty()}") }
    }
    private fun armFocusLease(duration: Long) {
        focusLease?.cancel()
        focusLease = scope.launch { delay(duration); if (!closed) { runCatching { stt?.stop() }; runCatching { tts?.stop() }; abandonFocus() } }
    }
    private fun abandonFocus() {
        focusLease?.cancel(); focusHeld = false
        runCatching { audioManager.abandonAudioFocusRequest(focusRequest) }
        onAudioFocusChanged(null)
    }
    private fun voiceFailure(message: String) {
        pendingListen = false; conversationListening = false; chunks.clear(); outputTurn = null
        mutableVoiceEvents.tryEmit(VoiceEvent.Unavailable(message))
        sttTimeout?.cancel(); ttsTimeout?.cancel()
        stt?.let { runCatching { it.removeListener(resultListener) }; runCatching { it.release() } }
        tts?.let { activeTtsListener?.let { listener -> runCatching { it.removeEventListener(listener) } }; runCatching { it.release() } }
        stt = null; tts = null; sttReady = false; ttsReady = false
        mutableState.update { it.copy(available = false, listening = false, speaking = false, message = message) }
        abandonFocus()
    }
    override fun stop() {
        pendingListen = false; conversationListening = false
        interruptSpeech()
        runCatching { stt?.stop() }
        mutableState.update { it.copy(listening = false, speaking = false, message = "음성 안내를 멈췄습니다.") }
        abandonFocus()
    }
    override fun close() {
        if (closed) return
        stop(); closed = true
        retiring?.let { boundary ->
            boundary.listener?.let { runCatching { boundary.instance.removeEventListener(it) } }
            runCatching { boundary.instance.release() }; boundary.done.complete(false)
        }; retiring = null
        stt?.let { runCatching { it.removeListener(resultListener) }; runCatching { it.release() } }
        tts?.let { activeTtsListener?.let { listener -> runCatching { it.removeEventListener(listener) } }; runCatching { it.release() } }
        stt = null; tts = null; sttReady = false; ttsReady = false
        sttTimeout?.cancel(); ttsTimeout?.cancel(); scope.cancel()
        mutableState.value = SpeechState(message = "음성 연결 해제", origin = DataOrigin.PLEOS)
    }
}
