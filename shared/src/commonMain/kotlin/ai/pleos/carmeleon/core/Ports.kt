package ai.pleos.carmeleon.core

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

interface NavigationGateway {
    val connection: StateFlow<ServiceConnection>
    val observed: StateFlow<ObservedGuidance> get() = EmptyGuidance.state
    suspend fun openSearch(keyword: String) = Unit
    suspend fun openRouteOptions() = Unit
    suspend fun openNavigationForeground() = Unit
    val events: Flow<NavigationEvent>
    suspend fun connect()
    suspend fun request(request: NavigationRequest)
    suspend fun cancel(requestId: String)
    fun close()
}

interface LocationGateway {
    val connection: StateFlow<ServiceConnection>
    val fixes: StateFlow<LocationFix?>
    suspend fun connect()
    fun close()
}

interface VoiceGateway {
    val state: StateFlow<SpeechState>
    val transcripts: Flow<String>
    /** Acquire audio focus without beginning speech; Android overrides with AudioManager. */
    suspend fun prepare(): Boolean = true
    suspend fun listen()
    suspend fun speak(text: String)
    fun stop()
    fun close()
}

/** Events describe SDK observations, never proof of a person's actual hearing. */
sealed interface VoiceEvent {
    data class Partial(val text: String) : VoiceEvent
    data class SpeechDetected(val source: String) : VoiceEvent
    data class PlaybackStarted(val turnId: String) : VoiceEvent
    data class PlaybackDone(val turnId: String) : VoiceEvent
    data class PlaybackInterrupted(val turnId: String) : VoiceEvent
    data class PlaybackStopped(val turnId: String) : VoiceEvent
    data class Unavailable(val reason: String) : VoiceEvent
}

interface StreamingVoiceGateway : VoiceGateway {
    val voiceEvents: Flow<VoiceEvent>
    suspend fun speakChunk(turnId: String, text: String, isFinal: Boolean)
    /** Local stop comes before a network cancellation; recognition remains active. */
    fun interruptSpeech()
}

interface VehicleGateway {
    val state: StateFlow<VehicleSnapshot>
    suspend fun connect()
    fun close()
}

interface JourneyRepository {
    val baseUrl: String
    suspend fun activeRoute(): JourneyRoute?
    suspend fun saveRoute(route: JourneyRoute): JourneyRoute
    suspend fun briefings(routeId: String): List<Briefing>
    suspend fun guide(location: Coordinate?, step: Int): GuideContent
    suspend fun nearby(kind: PoiKind, location: Coordinate?): List<PoiCandidate>
}

data class HttpReply(val status: Int, val body: String)
interface BackendTransport {
    suspend fun send(method: String, url: String, body: String? = null): HttpReply
}

private object EmptyGuidance { val state = kotlinx.coroutines.flow.MutableStateFlow(ObservedGuidance()) }
