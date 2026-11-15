package ai.pleos.carmeleon.agent

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AgentSessionTest {
    @Test fun streamsSentencesBeforeModelFinishesAndFinalizesOnlyLastChunk() {
        val session = AgentSession()
        val id = session.beginTurn("여기 어디야?")
        session.acceptChunk(id, "이 근처는 한강입니다. 다음 이야기도")
        val first = assertNotNull(session.nextChunk())
        assertEquals("이 근처는 한강입니다.", first.text)
        assertFalse(first.isFinal)
        session.acceptChunk(id, " 들려드릴게요.", isFinal = true)
        val last = assertNotNull(session.nextChunk())
        assertTrue(last.isFinal)
        assertTrue(session.acknowledgePlayback(first.generation))
        assertEquals(PlaybackEvidence.COMPLETED_CALLBACK, session.state.value.playback.single().evidence)
    }

    @Test fun interruptClearsQueuedSpeechAndRejectsLateModelTokens() {
        val session = AgentSession()
        val old = session.beginTurn("말해줘")
        session.acceptChunk(old, "첫 문장. 둘째 문장.")
        val sent = assertNotNull(session.nextChunk())
        val interrupted = session.interrupt()
        assertTrue(interrupted.stopRequired)
        assertEquals(sent.generation, interrupted.generation)
        assertNull(session.nextChunk())
        assertFalse(session.acceptChunk(old, "늦은 토큰", true))
        assertFalse(session.acknowledgePlayback(sent.generation))
        assertEquals(PlaybackEvidence.INTERRUPTED_POSITION_UNKNOWN, session.state.value.playback.single().evidence)
        assertEquals("첫 문장.", interrupted.interruptedText)
    }

    @Test fun newSpeechWaitsForActualStopBarrierAndLateCompletionCannotFinishNewTurn() {
        val session = AgentSession()
        val old = session.beginTurn("A")
        session.acceptChunk(old, "이전 답변.")
        val first = assertNotNull(session.nextChunk())
        val barrier = session.interrupt()
        val fresh = session.beginTurn("B")
        session.acceptChunk(fresh, "새 답변.", true)
        assertNull(session.nextChunk())
        assertFalse(session.acknowledgeStop(first.generation + 1))
        assertTrue(session.acknowledgeStop(barrier.generation))
        val newChunk = assertNotNull(session.nextChunk())
        assertFalse(session.acknowledgePlayback(first.generation))
        assertTrue(session.acknowledgePlayback(newChunk.generation))
    }

    @Test fun finalMarkerClosesAlreadyDrainedStreamWithoutDuplicatingWords() {
        val session = AgentSession()
        val id = session.beginTurn("A")
        session.acceptChunk(id, "답변.")
        val first = assertNotNull(session.nextChunk())
        session.acceptChunk(id, "", true)
        val final = assertNotNull(session.nextChunk())
        assertEquals("", final.text)
        assertTrue(final.isFinal)
        assertTrue(session.acknowledgePlayback(first.generation))
        assertEquals("답변.", session.state.value.playback.single().text)
    }

    @Test fun audioYieldNeverReplaysInterruptedBacklog() {
        val session = AgentSession()
        val id = session.beginTurn("A")
        session.acceptChunk(id, "첫 문장. 다음 문장.")
        session.nextChunk()
        val interrupted = session.yieldAudio()
        assertNull(session.nextChunk())
        assertTrue(session.acknowledgeStop(interrupted.generation))
        session.resumeAudio()
        assertNull(session.nextChunk())
        assertEquals(AgentPhase.IDLE, session.state.value.phase)
    }

    @Test fun serverDecisionOnlyAppliesToCurrentTurn() {
        val session = AgentSession()
        val old = session.beginTurn("A")
        val fresh = session.beginTurn("B")
        assertFalse(session.requireDecision(old, "old-proposal"))
        assertTrue(session.requireDecision(fresh, "fresh-proposal"))
        assertFalse(session.clearDecision("old-proposal"))
        assertTrue(session.clearDecision("fresh-proposal"))
    }

    @Test fun longOutputIsChunkedWithoutLosingCharacters() {
        val session = AgentSession(maxChunkCharacters = 30)
        val id = session.beginTurn("A")
        val text = "가".repeat(89)
        session.acceptChunk(id, text, true)
        val chunks = generateSequence { session.nextChunk() }.toList()
        assertEquals(3, chunks.size)
        assertEquals(text, chunks.joinToString("") { it.text })
        assertTrue(chunks.last().isFinal)
    }
}
