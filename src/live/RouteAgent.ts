import { AgentPlan, type AgentObservation, type AgentResult, type AgentDecision } from './agentProtocol';
import { BrowserJourney, positionOnRoad } from './journey';
import type { LiveMessage } from './protocol';
export type AgentTask = {
  id: string; topic: AgentDecision['topic']; goal: string; speech: string; reason: string;
  status: 'ready' | 'waiting_answer' | 'awaiting_approval' | 'in_route' | 'done' | 'dismissed' | 'stale';
  targetId: string; placeId?: string; proposalId?: string; inputId: string; createdAt: number;
  result?: AgentResult;
};
const key = 'carmeleon_route_agent_v1';
export const agentStage: Record<AgentTask['status'], string> = { ready: '준비했어요', waiting_answer: '답을 기다려요', awaiting_approval: '경로 변경 확인 중', in_route: '가는 중이에요', done: '챙겼어요', dismissed: '이번에는 넘어가요', stale: '상황이 바뀌었어요' };
const terminal = new Set(['done', 'dismissed', 'stale']);
export class RouteAgent {
  private version = 0;
  private listeners = new Set<() => void>();
  private request?: AbortController;
  private signature = '';
  private retryAt = 0;
  private generation = 0;
  private presenting = false;
  tasks: AgentTask[] = [];
  phase: 'idle' | 'planning' | 'error' = 'idle';
  error = '';
  constructor(private routeId: string, private storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage, private http: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => globalThis.fetch(url, init)) {
    try {
      const saved = JSON.parse(storage.getItem(key) || '{}')[routeId];
      if (Array.isArray(saved)) this.tasks = saved.filter(t => t && typeof t.id === 'string' && typeof t.goal === 'string' && typeof t.speech === 'string' && t.status in agentStage).slice(-24).map(t => ({ ...t, status: ['ready', 'awaiting_approval'].includes(t.status) ? 'stale' : t.status, result: undefined }));
    } catch { /* Existing originals and route state remain separate and untouched. */ }
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach(fn => fn()); }
  private commit(tasks: AgentTask[]) {
    const all = JSON.parse(this.storage.getItem(key) || '{}');
    this.storage.setItem(key, JSON.stringify({ ...all, [this.routeId]: tasks.map(({ result: _result, ...task }) => task) }));
    this.tasks = tasks; this.emit();
  }
  get current() { return [...this.tasks].reverse().find(t => !terminal.has(t.status)); }
  get blocksNarration() { return this.phase === 'planning' || !!this.current && ['ready', 'waiting_answer', 'awaiting_approval'].includes(this.current.status); }
  cancel() { if (this.phase !== 'planning' && !this.request) return; this.generation++; this.request?.abort(); this.request = undefined; this.signature = ''; this.phase = 'idle'; this.emit(); }
  userActivity() {
    if (this.phase === 'planning') { this.cancel(); this.signature = ''; }
    const current = this.current;
    if (current?.status === 'ready') this.commit(this.tasks.map(t => t.id === current.id ? { ...t, status: 'stale' } : t));
  }
  dispose() { this.cancel(); this.listeners.clear(); }
  clearSensitive() { this.cancel(); this.signature = ''; this.commit([]); }
  sync(journey: BrowserJourney) {
    const current = this.current; if (!current) return;
    const state = journey.state;
    const index = current.placeId ? state.route.stops.findIndex(stop => stop.poiId === current.placeId) : -1;
    let status = current.status;
    if (status === 'awaiting_approval' && !state.proposal) status = index >= 0 ? 'in_route' : 'dismissed';
    if (status === 'in_route' && index >= 0 && index < state.targetIndex) status = 'done';
    if (status === 'in_route' && index < 0) status = 'stale';
    if (['ready', 'waiting_answer'].includes(status) && current.targetId !== journey.target?.id) status = 'stale';
    if (status !== current.status) this.commit(this.tasks.map(t => t.id === current.id ? { ...t, status } : t));
  }
  private handled(targetId: string) {
    const topics = this.tasks.filter(t => t.status !== 'stale' && (t.targetId === targetId || ['meal', 'coffee', 'charging'].includes(t.topic))).map(t => t.topic);
    if (this.tasks.some(t => t.targetId === targetId && t.topic === 'visit_check' && t.status === 'done')) topics.push('briefing');
    return [...new Set(topics)].slice(-30);
  }
  async observe(journey: BrowserJourney, messages: LiveMessage[], event: AgentObservation['event'] = 'context_changed') {
    this.sync(journey);
    const s = journey.state, target = journey.target, road = s.leg, lastInput = [...messages].reverse().find(m => m.role === 'user');
    const current = this.current;
    if (!s.driving || s.preferences.quiet || s.proposal || !target || !road || !s.position || this.phase === 'planning' || Date.now() < this.retryAt) return;
    if (current && !(current.status === 'waiting_answer' && lastInput && current.inputId !== lastInput.id)) return;
    const coordinate = { latitude: target.latitude ?? target.lat!, longitude: target.longitude ?? target.lng! };
    const bucket = Math.floor(s.progress * 3);
    const scope = JSON.stringify([s.route.id, target.id, s.preferences, s.notes, s.materials.filter(m => m.selected).map(m => [m.id, m.text]), target.memo, target.time, lastInput?.id, bucket]);
    if (scope === this.signature) return;
    this.signature = scope; const generation = ++this.generation;
    const control = new AbortController(); this.request = control; this.phase = 'planning'; this.error = ''; this.emit();
    const input: AgentObservation = {
      event: current?.status === 'waiting_answer' ? 'answer' : event,
      routeId: s.route.id, revision: s.revision, targetId: target.id, situation: journey.situation, goal: s.preferences.goal,
      routeTitle: s.route.title.slice(0, 300), position: { ...s.position }, ahead: positionOnRoad(road, s.progress + (1 - s.progress) * .4) || s.position,
      target: { id: target.id, name: target.name, coordinate, memo: target.memo?.slice(0, 1500), time: target.time },
      upcoming: s.route.stops.slice(s.targetIndex, s.targetIndex + 8).map(stop => ({ id: stop.id, name: stop.name, time: stop.time })),
      notes: s.notes.slice(-12), materials: journey.targetMaterials.slice(0, 3).map(m => ({ id: m.id, name: m.name, text: m.text.slice(0, 8000) })),
      conversation: messages.slice(-8).map(m => ({ role: m.role, text: m.text.slice(0, 1000) })),
      world: { time: journey.world().time, elapsedSeconds: journey.world().elapsedSeconds, remainingSeconds: journey.world().remainingSeconds, progress: journey.world().progress },
      handledTopics: current?.status === 'waiting_answer' ? this.handled(target.id).filter(t => t !== current.topic) : this.handled(target.id),
      ...(current?.status === 'waiting_answer' ? { activeTask: { id: current.id, goal: current.goal, question: current.speech, topic: current.topic } } : {}),
    };
    try {
      const response = await this.http('/api/fallback/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.any([control.signal, AbortSignal.timeout(60000)]) });
      const result: AgentResult = await response.json();
      if (!response.ok) throw new Error('다음 행동을 준비하지 못했어요.');
      AgentPlan.parse(result.plan);
      const nowScope = JSON.stringify([s.route.id, journey.target?.id, s.preferences, s.notes, s.materials.filter(m => m.selected).map(m => [m.id, m.text]), journey.target?.memo, journey.target?.time, lastInput?.id, bucket]);
      if (control.signal.aborted || generation !== this.generation || journey.target?.id !== input.targetId || s.revision !== input.revision || s.preferences.quiet || !s.driving || s.proposal || nowScope !== scope) { this.signature = ''; return; }
      if (result.plan.outcome === 'wait') return;
      const task: AgentTask = { id: current?.id || crypto.randomUUID(), topic: result.plan.topic, goal: result.plan.goal, reason: result.plan.reason, speech: result.plan.speech, status: result.plan.outcome === 'complete' ? 'done' : 'ready', targetId: target.id, inputId: lastInput?.id || '', createdAt: Date.now(), result };
      if (result.plan.outcome === 'suggest_stop') {
        const place = result.places.find(p => p.id === result.plan.placeId);
        if (!place) throw new Error('실제 장소 후보를 확인하지 못했어요.');
        journey.registerPlace(place); task.placeId = place.id;
      }
      this.commit([...this.tasks.filter(t => t.id !== task.id), task].slice(-24));
    } catch {
      if (control.signal.aborted || generation !== this.generation) return;
      this.phase = 'error'; this.error = '이번 동행 작업은 보류했어요. 대화는 계속할 수 있어요.'; this.signature = ''; this.retryAt = Date.now() + 45000;
    } finally { if (generation === this.generation) { if (this.phase !== 'error') this.phase = 'idle'; this.request = undefined; this.emit(); } }
  }
  async present(journey: BrowserJourney) {
    const task = this.current;
    if (this.presenting || !task || task.status !== 'ready' || !task.result) return;
    if (task.targetId !== journey.target?.id || !journey.state.driving || journey.state.preferences.quiet || journey.state.proposal) return;
    this.presenting = true; const generation = this.generation;
    const control = new AbortController(); this.request = control;
    try {
      if (task.result.plan.outcome === 'suggest_stop') {
        await journey.propose(task.placeId!, control.signal);
        if (generation !== this.generation || control.signal.aborted) return;
        const refreshed = journey.proposal;
        if (refreshed && refreshed.extraSeconds > 600) { journey.decide(refreshed.id, 'cancel', 'button'); throw new Error('우회 부담이 바뀌었어요.'); }
        this.commit(this.tasks.map(t => t.id === task.id ? { ...t, status: 'awaiting_approval', proposalId: refreshed?.id } : t));
      } else this.commit(this.tasks.map(t => t.id === task.id ? { ...t, status: task.result!.plan.outcome === 'ask' ? 'waiting_answer' : 'done' } : t));
      return task;
    } catch {
      if (generation !== this.generation) return;
      this.commit(this.tasks.map(t => t.id === task.id ? { ...t, status: 'stale' } : t));
      this.error = '현재 경로에서 변경안을 확인하지 못해 이번 제안은 보류했어요.'; this.emit();
    } finally { this.presenting = false; if (this.request === control) this.request = undefined; }
  }
  resolve(id: string, status: 'done' | 'dismissed', messages: LiveMessage[]) {
    const current = this.current, last = [...messages].reverse().find(m => m.role === 'user');
    if (!current || current.id !== id || current.status !== 'waiting_answer' || !last || last.id === current.inputId) throw new Error('확인 질문에 대한 새 답이 필요해요.');
    this.commit(this.tasks.map(t => t.id === id ? { ...t, status } : t));
    return { ok: true, goal: current.goal, status };
  }
}
