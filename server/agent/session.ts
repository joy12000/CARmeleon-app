import type { AgentInputItem, Session } from '@openai/agents';
import { ApiError, TurnRecord } from './models';
import type { Store } from './store';

type SessionData = { pathId: string; batches: { turnId: string; items: AgentInputItem[] }[] };
export type SpeechChunk = { turnId: string; chunkId: string; sequence: number; text: string; isFinal: boolean };
export type Playback = { turnId: string; chunkId?: string; status: 'STARTED'|'COMPLETED'|'STOPPED'|'FAILED'|'UNKNOWN'; at: string };

/** SDK history is durable, but generated text is replayed to the model as delivered only after a real playback ACK. */
export class DurableSession implements Session {
  constructor(private store: Store, private accountId: string, private sessionId: string, private pathId: string, private turnId: string) {}
  async getSessionId() { return this.sessionId; }
  async getItems(limit?: number): Promise<AgentInputItem[]> {
    return this.store.read(this.accountId, async r => {
      const data = await r.get<SessionData>('sdk-session', this.sessionId);
      if (data && data.pathId !== this.pathId) throw new ApiError(409, 'SESSION_PATH_MISMATCH', '다른 경로의 대화를 섞을 수 없어요.');
      const playback = await r.list<Playback>('playback');
      const chunks = await r.list<SpeechChunk>('speech-chunk');
      const out: AgentInputItem[] = [];
      // Tool calls remain in the canonical turn/action records. Do not re-execute them from a truncated conversation.
      for (const batch of (data?.batches ?? []).slice(-16)) {
        for (const item of batch.items) if ('role' in item && item.role === 'user') out.push(item);
        const completion = playback.filter(p => p.turnId === batch.turnId && p.status === 'COMPLETED');
        const stopped = playback.some(p => p.turnId === batch.turnId && ['STOPPED', 'FAILED', 'UNKNOWN'].includes(p.status));
        const completedAll = completion.some(p => !p.chunkId) && !stopped;
        const confirmed = chunks.filter(c => c.turnId === batch.turnId && c.text && (completedAll || completion.some(p => p.chunkId === c.chunkId) && !playback.some(p => p.turnId === batch.turnId && p.chunkId === c.chunkId && ['STOPPED', 'FAILED', 'UNKNOWN'].includes(p.status)))).sort((a,b) => a.sequence - b.sequence).map(c => c.text).join(' ');
        if (confirmed) out.push({ role: 'assistant', type: 'message', status: 'completed', content: [{ type: 'output_text', text: confirmed }] });
        else {
          const turn = await r.get<TurnRecord>('turn', batch.turnId);
          if (turn?.generatedText) out.push({ role: 'user', type: 'message', content: '[전달 상태: 이전 AI 응답은 중단되었거나 재생 완료가 확인되지 않았음. 사용자가 들었다고 가정하지 말 것. 실행된 행동은 최신 경로·기억·작업 기록을 기준으로 할 것.]' });
        }
      }
      return limit ? out.slice(-limit) : out;
    });
  }
  async addItems(items: AgentInputItem[]) {
    await this.store.write(this.accountId, async r => {
      const data = await r.get<SessionData>('sdk-session', this.sessionId) ?? { pathId: this.pathId, batches: [] };
      if (data.pathId !== this.pathId) throw new ApiError(409, 'SESSION_PATH_MISMATCH', '다른 경로의 대화를 섞을 수 없어요.');
      const existing = data.batches.find(b => b.turnId === this.turnId);
      if (existing) existing.items.push(...items); else data.batches.push({ turnId: this.turnId, items });
      // Bound raw conversation retention; durable path/memory/actions do not depend on it.
      data.batches = data.batches.slice(-40);
      await r.put('sdk-session', this.sessionId, data);
    });
  }
  async popItem() {
    return this.store.write(this.accountId, async r => {
      const data = await r.get<SessionData>('sdk-session', this.sessionId);
      const batch = data?.batches[data.batches.length - 1];
      const item = batch?.items.pop();
      if (data) await r.put('sdk-session', this.sessionId, data);
      return item;
    });
  }
  async clearSession() { await this.store.write(this.accountId, r => r.remove('sdk-session', this.sessionId)); }
}

/** Semantic chunking is independent of tokens and bounded; it never streams tool JSON/reasoning. */
export class SentenceChunks {
  private buffer = '';
  push(delta: string): string[] {
    this.buffer += delta;
    const chunks: string[] = [];
    while (this.buffer.length) {
      const sentence = /[.!?。！？]\s|[.!?。！？]$|\n/.exec(this.buffer);
      let end = sentence ? sentence.index + sentence[0].length : -1;
      if (end < 0 && this.buffer.length >= 110) {
        const segment = this.buffer.slice(0, 110);
        end = Math.max(segment.lastIndexOf(' '), segment.lastIndexOf(','), segment.lastIndexOf('，'));
        if (end < 30) end = -1;
      }
      if (end < 0) break;
      const text = this.clean(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end);
      if (text) chunks.push(text);
    }
    return chunks;
  }
  finish() { const text = this.clean(this.buffer); this.buffer = ''; return text ? [text] : []; }
  private clean(text: string) { return text.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim(); }
}
