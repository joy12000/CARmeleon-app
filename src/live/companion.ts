import { BrowserJourney, meters, positionOnRoad, type Place, type Position } from './journey';
import type { RoadRoute } from '../components/phone/roadDirections';
import type { PreparedSpeech, PrepareRequest } from '../../server/fallback/prepare';
import { checkEncounter, encounterIntroduction, encounterRange, type Encounter, type EncounterEvidence, type EncounterInput } from './encounter';
export type CompanionCue = {
  id: string; topic: string; kind: 'travel' | 'work' | 'daily'; anchor: number; place?: Place;
  prepared?: PreparedSpeech; state: 'preparing' | 'ready' | 'scheduled' | 'spoken' | 'skipped' | 'error'; reason?: string;
  encounter?: Encounter; encounterEvidence?: EncounterEvidence; spokenText?: string;
};
/** Projection stays within each provider line, never across disconnected road gaps. */
export function nearestRoadPoint(road: RoadRoute, p: Position): { distance: number; progress: number } {
  let total = 0, before = 0, best = { distance: Infinity, progress: 0 };
  for (const line of road.lines) for (let i = 1; i < line.length; i++) total += meters(line[i - 1], line[i]);
  for (const line of road.lines) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], length = meters(a, b);
    const scale = Math.cos(p.latitude * Math.PI / 180), x = (b.longitude - a.longitude) * scale, y = b.latitude - a.latitude;
    const t = Math.max(0, Math.min(1, (((p.longitude - a.longitude) * scale) * x + (p.latitude - a.latitude) * y) / (x * x + y * y || 1)));
    const distance = meters(p, { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t });
    if (distance < best.distance) best = { distance, progress: (before + length * t) / Math.max(1, total) };
    before += length;
  }
  return best;
}
export function chooseCue(cues: CompanionCue[], input: EncounterInput & { duration: number; speed: number; leadSpeed?: number; quiet: boolean; idle: boolean; sinceUser: number; sinceSpeech: number }) {
  if (input.quiet || !input.idle || input.sinceUser < 12000 || input.sinceSpeech < 18000) return undefined;
  for (const cue of [...cues].sort((a, b) => a.anchor - b.anchor)) {
    if (cue.state !== 'ready' || !cue.prepared) continue;
    if (cue.kind === 'travel') {
      const check = checkEncounter(cue, input);
      if (check.status === 'passed') { cue.state = 'skipped'; cue.reason = '소개할 지점을 지나쳤어요.'; continue; }
      if (check.status !== 'approaching' || !check.evidence) continue;
      const spokenText = encounterIntroduction(check.evidence) + cue.prepared.speech;
      const needed = Math.max(10, spokenText.length / 7 + 8);
      if ((cue.anchor - input.progress) * input.duration / Math.max(1, input.speed) < needed) {
        cue.state = 'skipped'; cue.reason = '가까워졌지만 설명을 마칠 시간이 부족해요.'; continue;
      }
      cue.encounterEvidence = check.evidence; cue.spokenText = spokenText;
      return cue;
    }
    const needed = Math.max(8, cue.prepared.speech.length / 7 + 2);
    const remaining = (cue.anchor - input.progress) * input.duration / Math.max(1, input.speed);
    if (remaining < needed) { cue.state = 'skipped'; cue.reason = '발화할 틈을 지나 다음 대화를 기다려요.'; continue; }
    const lead = Math.max(cue.kind === 'work' ? 0.3 : 0.15, (needed + 4) * (input.leadSpeed ?? input.speed) / Math.max(1, input.duration));
    if (input.progress >= Math.max(0.08, cue.anchor - lead)) return cue;
  }
  return undefined;
}
/** Only a simulated clock is slowed. Route geometry and spoken-window checks stay real. */
export function demoPlaybackSpeed(input: EncounterInput & { selected: number; automatic: boolean; duration: number; cues: CompanionCue[]; preparing: boolean; busy: boolean; quiet: boolean; sinceUser: number; sinceSpeech: number }) {
  if (!input.automatic) return input.selected;
  if (input.busy) return 1;
  if (input.quiet) return input.selected;
  if (input.preparing) return 1;
  if (input.progress < 0.08) return input.selected;
  const wait = Math.max(0, 12 - input.sinceUser / 1000, 18 - input.sinceSpeech / 1000);
  for (const cue of input.cues) {
    if (!['ready', 'preparing'].includes(cue.state) || cue.anchor <= input.progress) continue;
    if (cue.kind === 'travel') {
      const check = checkEncounter(cue, input), limit = cue.encounter && encounterRange(cue.encounter);
      if (check.evidence && limit && check.evidence.alongMeters <= limit + 60 && check.evidence.distanceMeters <= limit + 60) return 1;
      continue;
    }
    const needed = cue.prepared ? Math.max(8, cue.prepared.speech.length / 7 + 2) : 24;
    if ((cue.anchor - input.progress) * input.duration / input.selected <= needed + wait + 4) return 1;
  }
  return input.selected;
}
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
function shortKey(value: string) { let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return (hash >>> 0).toString(36); }
export class CompanionQueue {
  private version = 0;
  private listeners = new Set<() => void>();
  private generation = 0;
  private spoken = new Set<string>();
  cues: CompanionCue[] = [];
  status: 'idle' | 'preparing' | 'ready' = 'idle';
  lastCue?: CompanionCue;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach(fn => fn()); }
  clear() { this.generation++; this.cues = []; this.lastCue = undefined; this.status = 'idle'; this.emit(); }
  restart() { this.spoken.clear(); this.clear(); }
  constructor(private http: Fetcher = (input, init) => globalThis.fetch(input, init)) {}
  async prepare(journey: BrowserJourney, signal: AbortSignal) {
    const generation = ++this.generation, s = journey.state, target = journey.target, road = s.leg;
    for (const id of s.heardCueIds) this.spoken.add(id);
    this.cues = []; this.status = 'preparing'; this.emit();
    if (!target || !road || s.preferences.quiet) { this.status = 'idle'; this.emit(); return; }
    const kind = journey.situation;
    const materials = journey.targetMaterials.slice(0, 3).map(m => ({ id: m.id, name: m.name, text: m.text.slice(0, 8000) }));
    const notes = s.notes.slice(-12).map(n => n.text);
    const sourceKey = shortKey(JSON.stringify(kind === 'travel' && !materials.length ? [target.id, kind, target.name] : [target.id, kind, materials, notes, s.preferences.goal, target.time, target.memo, s.route.title]));
    const requests: { cue: CompanionCue; request: PrepareRequest }[] = [];
    if (kind === 'travel' || kind === 'work' || materials.length || notes.length || s.preferences.goal || target.memo) {
      requests.push({
        cue: { id: s.route.id + sourceKey, kind, topic: kind === 'work' ? target.name + ' 방문 전 핵심' : target.name + ' 이야기', anchor: kind === 'work' ? .35 : 1, state: 'preparing', ...(kind === 'travel' && typeof (target.latitude ?? target.lat) === 'number' && typeof (target.longitude ?? target.lng) === 'number' ? { encounter: { kind: 'destination' as const, name: target.name, coordinate: { latitude: (target.latitude ?? target.lat)!, longitude: (target.longitude ?? target.lng)! } } } : {}) },
        request: { kind, place: { name: target.name, address: target.address }, goal: s.preferences.goal, materials, notes, visit: { routeTitle: s.route.title, time: target.time, memo: target.memo?.slice(0, 1500) } },
      });
    }
    // Prepare at most one verified roadside place in addition to the destination.
    if (kind === 'travel') {
      try {
        const center = positionOnRoad(road, 0.45);
        const response = await this.http('/api/fallback/places', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '관광명소', center }), signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
        const data = await response.json();
        if (response.ok && data.status === 'READY') {
          const candidates = (data.places as Place[]).map(place => ({ place, hit: nearestRoadPoint(road, place.coordinate) }))
            .filter(({ place, hit }) => hit.distance <= 150 && hit.progress >= 0.18 && hit.progress <= 0.72 && place.name !== target.name)
            .sort((a, b) => a.hit.distance - b.hit.distance);
          const candidate = candidates[0];
          if (candidate && generation === this.generation && !signal.aborted) {
            journey.registerPlace(candidate.place);
            requests.unshift({
              cue: { id: s.route.id + ':' + candidate.place.id, kind: 'travel', topic: candidate.place.name, anchor: candidate.hit.progress, place: candidate.place, state: 'preparing', encounter: { kind: 'roadside', name: candidate.place.name, coordinate: candidate.place.coordinate } },
              request: { kind: 'travel', place: { name: candidate.place.name, address: candidate.place.address }, goal: '', materials: [], notes: [] },
            });
          }
        }
      } catch { /* A destination story remains useful when no route-side place is verified. */ }
    }
    if (generation !== this.generation || signal.aborted) return;
    this.cues = requests.map(r => this.spoken.has(r.cue.id) ? { ...r.cue, state: 'spoken' } : r.cue); this.emit();
    await Promise.all(requests.map(async ({ cue, request }, index) => {
      if (this.spoken.has(cue.id)) return;
      try {
        const response = await this.http('/api/fallback/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
        const prepared = await response.json();
        if (!response.ok || typeof prepared.speech !== 'string' || !prepared.grounded) throw new Error('확인할 수 있는 이야기만 준비해요.');
        if (generation !== this.generation || signal.aborted) return;
        this.cues[index] = { ...cue, prepared, state: 'ready' }; this.emit();
      } catch {
        if (generation !== this.generation || signal.aborted) return;
        this.cues[index] = { ...cue, state: 'error', reason: '출처가 확인될 때까지 보류해요.' }; this.emit();
      }
    }));
    if (generation === this.generation && !signal.aborted) { this.status = 'ready'; this.emit(); }
  }
  claim(input: Parameters<typeof chooseCue>[1]) {
    if (this.lastCue?.state === 'scheduled') return;
    const cue = chooseCue(this.cues, input);
    if (!cue) return;
    cue.state = 'scheduled'; this.lastCue = cue; this.spoken.add(cue.id); this.emit(); return cue;
  }
  expired(input: EncounterInput) { return this.lastCue?.kind === 'travel' && this.lastCue.state === 'scheduled' && ['passed', 'unverified'].includes(checkEncounter(this.lastCue, input).status); }
  finish(interrupted = false) {
    if (!this.lastCue || this.lastCue.state !== 'scheduled') return;
    this.lastCue.state = interrupted ? 'skipped' : 'spoken'; this.emit();
  }
}
