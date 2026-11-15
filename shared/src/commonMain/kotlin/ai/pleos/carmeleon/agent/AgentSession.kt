package ai.pleos.carmeleon.agent

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class AgentPhase { IDLE, LISTENING, THINKING, SPEAKING, AWAITING_APPROVAL, STOPPING, YIELDED, FAILED }
enum class PlaybackEvidence { COMPLETED_CALLBACK, INTERRUPTED_POSITION_UNKNOWN }
data class SpeechChunk(val turnId: String, val generation: Long, val sequence: Int,
    val text: String, val isFinal: Boolean, val sourceChunkId: String? = null)
data class PlaybackRecord(val turnId: String, val text: String, val evidence: PlaybackEvidence)
data class InterruptedTurn(val turnId: String?, val generation: Long, val stopRequired: Boolean,
    val interruptedText: String, val completedText: String)
data class AgentSessionState(
    val phase: AgentPhase = AgentPhase.IDLE,
    val turnId: String? = null,
    val generation: Long = 0,
    val transcript: String = "",
    val response: String = "",
    val queuedChunks: Int = 0,
    val awaitingStop: Boolean = false,
    val error: String? = null,
    val decisionId: String? = null,
    val playback: List<PlaybackRecord> = emptyList(),
)

/**
 * Pure local turn state. Call interrupt, stop local playback, then cancel server work.
 * SDK callbacks have no utterance IDs: the adapter must enforce a real stop barrier before
 * acknowledging it here. Merely attaching a new app generation to a late callback is unsafe.
 */
class AgentSession(private val idPrefix: String = "turn", private val maxChunkCharacters: Int = 120) {
    init { require(maxChunkCharacters >= 20) }
    private val mutableState = MutableStateFlow(AgentSessionState())
    val state: StateFlow<AgentSessionState> = mutableState.asStateFlow()
    private var nextId = 0L
    private var sequence = 0
    private var pendingText = ""
    private var streamEnded = false
    private val queue = ArrayDeque<SpeechChunk>()
    private val sent = mutableListOf<SpeechChunk>()
    private var stoppingGeneration: Long? = null
    private var stoppedTurnId: String? = null

    /** Returns the new turn ID; if audio was active, stop is still required before draining it. */
    fun beginTurn(text: String): String {
        require(text.isNotBlank())
        if (mutableState.value.turnId != null && !streamEnded || sent.isNotEmpty() || queue.isNotEmpty()) interrupt()
        val id = "$idPrefix-${++nextId}"
        val current = mutableState.value
        pendingText = ""
        streamEnded = false
        sequence = 0
        queue.clear()
        sent.clear()
        mutableState.value = current.copy(phase = if (current.awaitingStop) AgentPhase.STOPPING else AgentPhase.THINKING,
            turnId = id, generation = current.generation + 1, transcript = text,
            response = "", queuedChunks = 0, decisionId = null, error = null)
        return id
    }

    fun listening(partial: String = "") {
        mutableState.value = mutableState.value.copy(phase = if (mutableState.value.awaitingStop)
            AgentPhase.STOPPING else AgentPhase.LISTENING, transcript = partial)
    }

    /** Accept only the user-visible text event, never internal reasoning/tool JSON. */
    fun acceptChunk(turnId: String, delta: String, isFinal: Boolean = false): Boolean {
        val current = mutableState.value
        if (current.turnId != turnId || streamEnded || current.phase == AgentPhase.FAILED) return false
        pendingText += delta
        mutableState.value = current.copy(response = current.response + delta)
        extractChunks(flush = isFinal)
        if (isFinal) {
            streamEnded = true
            if (queue.isNotEmpty()) {
                val last = queue.removeLast()
                queue.addLast(last.copy(isFinal = true))
            } else {
                // The adapter closes its existing streaming utterance. This marker must not
                // be spoken as text or mapped to a fabricated onDone acknowledgement.
                queue.addLast(SpeechChunk(turnId, mutableState.value.generation, sequence++, "", true))
            }
        }
        publishQueue()
        return true
    }

    /** Server chunks already are complete semantic units. Preserve their identity for playback ACKs. */
    fun acceptSpeechChunk(turnId: String, text: String, isFinal: Boolean, sourceChunkId: String? = null): Boolean {
        val current = mutableState.value
        if (current.turnId != turnId || streamEnded || current.phase == AgentPhase.FAILED) return false
        mutableState.value = current.copy(response = current.response + text)
        if (text.isNotBlank() || isFinal) queue.addLast(SpeechChunk(turnId, current.generation, sequence++, text, isFinal, sourceChunkId))
        streamEnded = isFinal
        publishQueue()
        return true
    }

    /** Dropped text was never submitted to an audio service and must not enter sent/playback evidence. */
    fun discardQueuedChunks() {
        queue.clear(); pendingText = ""
        publishQueue()
    }

    /** A completed standalone sentence proves only this submitted sentence completed, not the whole generated turn. */
    fun acknowledgeChunk(generation: Long, sequence: Int): Boolean {
        val current = mutableState.value
        if (current.awaitingStop || current.generation != generation) return false
        val item = sent.firstOrNull { it.generation == generation && it.sequence == sequence } ?: return false
        sent.remove(item)
        mutableState.value = current.copy(
            phase = if (streamEnded && queue.isEmpty() && sent.isEmpty()) {
                if (current.decisionId != null) AgentPhase.AWAITING_APPROVAL else AgentPhase.IDLE
            } else AgentPhase.THINKING,
            playback = if (item.text.isBlank()) current.playback else current.playback +
                PlaybackRecord(item.turnId, item.text, PlaybackEvidence.COMPLETED_CALLBACK))
        return true
    }

    /** Drain while the adapter can accept text, not only after onDone (which ends the whole stream). */
    fun nextChunk(): SpeechChunk? {
        if (mutableState.value.awaitingStop || mutableState.value.phase == AgentPhase.YIELDED) return null
        val chunk = queue.removeFirstOrNull() ?: return null
        sent += chunk
        mutableState.value = mutableState.value.copy(phase = AgentPhase.SPEAKING, queuedChunks = queue.size)
        return chunk
    }

    fun requireDecision(turnId: String, decisionId: String): Boolean {
        if (mutableState.value.turnId != turnId) return false
        mutableState.value = mutableState.value.copy(phase = AgentPhase.AWAITING_APPROVAL, decisionId = decisionId)
        return true
    }

    fun clearDecision(decisionId: String): Boolean {
        if (mutableState.value.decisionId != decisionId) return false
        mutableState.value = mutableState.value.copy(decisionId = null, phase = AgentPhase.IDLE)
        return true
    }

    /** Call immediately on reliable local speech onset, without awaiting final STT or the network. */
    fun interrupt(): InterruptedTurn {
        val current = mutableState.value
        val text = sent.joinToString("") { it.text }
        val existingBarrier = stoppingGeneration
        val mustStop = sent.isNotEmpty() || existingBarrier != null
        if (sent.isNotEmpty()) {
            stoppingGeneration = current.generation
            stoppedTurnId = current.turnId
        }
        queue.clear()
        pendingText = ""
        streamEnded = true
        sent.clear()
        val record = current.turnId?.takeIf { text.isNotEmpty() }?.let {
            PlaybackRecord(it, text, PlaybackEvidence.INTERRUPTED_POSITION_UNKNOWN)
        }
        mutableState.value = current.copy(phase = if (mustStop) AgentPhase.STOPPING else AgentPhase.LISTENING,
            turnId = null, generation = current.generation + 1, queuedChunks = 0,
            awaitingStop = mustStop, decisionId = null,
            playback = if (record != null) current.playback + record else current.playback)
        return InterruptedTurn(current.turnId ?: stoppedTurnId, existingBarrier ?: current.generation,
            mustStop, text, current.playback.filter { it.evidence == PlaybackEvidence.COMPLETED_CALLBACK }
                .joinToString("\n") { it.text })
    }

    fun acknowledgeStop(stoppedGeneration: Long): Boolean {
        if (stoppingGeneration != stoppedGeneration) return false
        stoppingGeneration = null
        stoppedTurnId = null
        mutableState.value = mutableState.value.copy(awaitingStop = false,
            phase = when (mutableState.value.phase) {
                AgentPhase.YIELDED -> AgentPhase.YIELDED
                AgentPhase.FAILED -> AgentPhase.FAILED
                else -> if (mutableState.value.turnId == null) AgentPhase.LISTENING else AgentPhase.THINKING
            })
        return true
    }

    /** Only the adapter's unambiguously owned, fully finalized utterance may finish a turn. */
    fun acknowledgePlayback(generation: Long): Boolean {
        val current = mutableState.value
        if (current.awaitingStop || generation != current.generation || !streamEnded ||
            queue.isNotEmpty() || sent.isEmpty()) return false
        val id = current.turnId ?: return false
        val text = sent.joinToString("") { it.text }
        sent.clear()
        mutableState.value = current.copy(phase = if (current.decisionId != null)
            AgentPhase.AWAITING_APPROVAL else AgentPhase.IDLE,
            playback = current.playback + PlaybackRecord(id, text, PlaybackEvidence.COMPLETED_CALLBACK))
        return true
    }

    fun fail(turnId: String, message: String): Boolean {
        if (mutableState.value.turnId != turnId) return false
        interrupt()
        mutableState.value = mutableState.value.copy(phase = AgentPhase.FAILED, error = message)
        return true
    }

    fun yieldAudio(): InterruptedTurn {
        val interrupted = interrupt()
        mutableState.value = mutableState.value.copy(phase = AgentPhase.YIELDED)
        return interrupted
    }

    fun resumeAudio() {
        val current = mutableState.value
        if (current.phase != AgentPhase.YIELDED) return
        mutableState.value = current.copy(phase = if (current.awaitingStop) AgentPhase.STOPPING else AgentPhase.IDLE)
        // Interrupted words are never automatically replayed after a phone call/native guidance.
    }

    private fun extractChunks(flush: Boolean) {
        while (pendingText.isNotEmpty()) {
            val sentenceEnd = pendingText.indexOfFirst { it == '.' || it == '?' || it == '!' || it == '\n' || it == '。' }
            val end = when {
                sentenceEnd >= 0 && sentenceEnd < maxChunkCharacters -> sentenceEnd + 1
                pendingText.length >= maxChunkCharacters -> {
                    val boundary = pendingText.lastIndexOf(' ', maxChunkCharacters - 1)
                    if (boundary > maxChunkCharacters / 2) boundary + 1 else maxChunkCharacters
                }
                flush -> pendingText.length
                else -> return
            }
            val text = pendingText.take(end)
            pendingText = pendingText.drop(end)
            if (text.isNotBlank()) queue.addLast(SpeechChunk(mutableState.value.turnId!!,
                mutableState.value.generation, sequence++, text, false))
        }
    }

    private fun publishQueue() { mutableState.value = mutableState.value.copy(queuedChunks = queue.size) }
}
