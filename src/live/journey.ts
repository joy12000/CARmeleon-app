import type { RouteStop, SavedRoute } from '../types';
import type { MapPoint } from '../components/phone/mapProviders';
import { getRoadRoute, type RoadRoute } from '../components/phone/roadDirections';
import { focusFromGoal, situationFor, type CompanionPreferences } from './situation';

export type Position = { latitude: number; longitude: number };
export type Place = { id: string; name: string; coordinate: Position; address?: string; distanceMeters?: number; source: { url: string } };
export type Note = { id: string; text: string };
export type Material = { id: string; name: string; text: string; selected: boolean; stopId: string };
export type Proposal = { id: string; revision: number; place?: Place; action: 'add' | 'skip' | 'route'; label: string; skipId?: string; extraSeconds: number; distanceMeters: number; afterInput: number; from: Position; expires: number; preview?: RoadRoute; routeStops?: RouteStop[]; title?: string; beforeNames?: string[]; afterNames?: string[] };
export type BrowserSnapshot = {
  route: SavedRoute; revision: number; targetIndex: number; position: Position | null;
  driving: boolean; progress: number; leg: RoadRoute | null; roadError: string;
  proposal: Proposal | null; notes: Note[]; materials: Material[]; places: Place[];
  preferences: CompanionPreferences;
  arrival: { name: string; detour: boolean; nextName?: string } | null;
  heardCueIds: string[];
  worldTime: number; elapsedSeconds: number;
};
type RouteLoader = (points: MapPoint[], signal: AbortSignal) => Promise<RoadRoute>;
const storageKey = 'carmeleon_browser_context_v1';
const coordinateOf = (stop: Partial<RouteStop>) => {
  const latitude = stop.latitude ?? stop.lat, longitude = stop.longitude ?? stop.lng;
  return typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
};
const point = (id: string, name: string, p: Position): MapPoint => ({ id, name, index: 0, ...p });
export function meters(a: Position, b: Position) {
  const radians = Math.PI / 180, lat = (b.latitude - a.latitude) * radians, lng = (b.longitude - a.longitude) * radians;
  const x = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, x)), Math.sqrt(Math.max(0, 1 - x)));
}
export function positionOnRoad(road: RoadRoute, fraction: number): Position | null {
  const segments: { a: Position; b: Position; distance: number }[] = [];
  // Separate provider lines are never joined with fabricated straight segments.
  for (const line of road.lines) for (let i = 1; i < line.length; i++) segments.push({ a: line[i - 1], b: line[i], distance: meters(line[i - 1], line[i]) });
  const total = segments.reduce((n, s) => n + s.distance, 0);
  let remaining = Math.max(0, Math.min(1, fraction)) * total;
  for (const segment of segments) {
    if (remaining <= segment.distance && segment.distance > 0) {
      const t = remaining / segment.distance;
      return { latitude: segment.a.latitude + (segment.b.latitude - segment.a.latitude) * t, longitude: segment.a.longitude + (segment.b.longitude - segment.a.longitude) * t };
    }
    remaining -= segment.distance;
  }
  return segments[segments.length - 1]?.b || road.lines[0]?.[0] || null;
}
export function approvalIntent(text: string): 'approve' | 'cancel' | null {
  if (/[?？]/.test(text)) return null;
  const normalized = text.replace(/[\s.,!?~。]/g, '');
  if (/^(아니|아니요|취소|취소해|취소해줘|안할래|바꾸지마|그대로가|가지마|아니그대로가|기존경로유지|기존대로가자)$/.test(normalized)) return 'cancel';
  if (/^(응|네|예|좋아|좋아요|승인|승인해|승인해줘|적용해|적용해줘|거기로가|거기로가자|추가해|추가해줘|그래|응그렇게해줘|그렇게해|좋아추가해줘|응그렇게바꿔줘|그렇게바꿔줘|그경로로바꿔|응그경로로바꿔줘|변경적용|이대로가자|네그렇게해주세요|좋아그렇게해줘|응좋아)$/.test(normalized)) return 'approve';
  return null;
}
export class BrowserJourney {
  private listeners = new Set<() => void>();
  private latestInput = { serial: 0, text: '' };
  private seenPlaces = new Map<string, { place: Place; at: number; revision: number }>();
  private legControl?: AbortController;
  private version = 0;
  private lastSaved = 0;
  private lastChange?: { route: SavedRoute; targetIndex: number; revision: number; label: string };
  private detours = new Set<string>();
  readonly initialPosition: Position | null;
  private initialIndex: number;
  private homePosition: Position | null;
  state: BrowserSnapshot;
  constructor(route: SavedRoute, private persistRoute: (route: SavedRoute) => void,
    private storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
    private routeLoader: RouteLoader = getRoadRoute, origin?: Position) {
    const first = route.stops[0] && coordinateOf(route.stops[0]);
    this.initialPosition = origin || first || null;
    this.initialIndex = origin ? 0 : Math.min(1, route.stops.length);
    this.homePosition = origin || null;
    let saved: { notes?: Note[]; materials?: Material[]; preferences?: CompanionPreferences; heardCueIds?: string[]; cursor?: { signature: string; targetIndex: number; position: Position; detours?: string[]; arrival?: BrowserSnapshot['arrival']; worldTime?: number; elapsedSeconds?: number } } = {};
    try { saved = JSON.parse(storage.getItem(storageKey) || '{}')[route.id] || {}; } catch { /* preserve unreadable storage */ }
    const cursor = saved.cursor?.signature === JSON.stringify(route.stops.map(s => [s.id, s.latitude ?? s.lat, s.longitude ?? s.lng])) &&
      Number.isInteger(saved.cursor.targetIndex) && saved.cursor.targetIndex >= 0 && saved.cursor.targetIndex <= route.stops.length && coordinateOf(saved.cursor.position) ? saved.cursor : null;
    this.state = { route, revision: 1, targetIndex: cursor?.targetIndex ?? (origin ? 0 : Math.min(1, route.stops.length)), position: cursor?.position || this.initialPosition,
      driving: false, progress: 0, leg: null, roadError: '', proposal: null, places: [],
      preferences: { focus: ['auto', 'work', 'travel', 'daily'].includes(saved.preferences?.focus || '') ? saved.preferences!.focus : 'auto', goal: typeof saved.preferences?.goal === 'string' ? saved.preferences.goal.slice(0, 300) : '', quiet: saved.preferences?.quiet === true },
      arrival: cursor?.arrival || null,
      worldTime: Number.isFinite(cursor?.worldTime) ? cursor!.worldTime! : Date.now(), elapsedSeconds: Number.isFinite(cursor?.elapsedSeconds) ? cursor!.elapsedSeconds! : 0,
      heardCueIds: Array.isArray(saved.heardCueIds) ? saved.heardCueIds.filter(id => typeof id === 'string').slice(-60) : [],
      notes: Array.isArray(saved.notes) ? saved.notes.filter(n => typeof n?.id === 'string' && typeof n?.text === 'string').slice(0, 40) : [],
      materials: Array.isArray(saved.materials) ? saved.materials.filter(m => typeof m?.id === 'string' && typeof m?.text === 'string' && typeof m?.name === 'string').slice(0, 12) : [] };
    this.detours = new Set(cursor?.detours || []);
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach(fn => fn()); }
  get target() { return this.state.route.stops[this.state.targetIndex]; }
  get proposal() { return this.state.proposal; }
  get targetMaterials() { return this.state.materials.filter(m => m.selected && m.text.trim() && (!m.stopId || m.stopId === this.target?.id)); }
  get situation() { return situationFor(this.state.route, this.target, this.targetMaterials.length > 0, this.state.preferences); }
  get canUndo() { return this.lastChange?.revision === this.state.revision; }
  recordInput(text: string) { this.latestInput = { serial: this.latestInput.serial + 1, text }; }
  dispose() { this.legControl?.abort(); this.listeners.clear(); }
  context() {
    return { environment: 'BROWSER_SIMULATION', positionSource: 'SIMULATED_ON_KAKAO_ROAD', ...this.state,
      world: this.world(),
      situation: this.situation, target: this.target || null, targetMaterials: this.targetMaterials.slice(0, 3).map(m => ({ id: m.id, name: m.name, excerpt: m.text.slice(0, 8000) })),
      lastChange: this.canUndo ? { label: this.lastChange!.label, canUndo: true } : null,
      home: this.homePosition ? { id: 'shortcut:home', name: '집', coordinate: this.homePosition } : null,
      proposal: this.state.proposal ? { ...this.state.proposal, preview: undefined } : null,
      leg: this.state.leg ? { provider: this.state.leg.provider, distanceMeters: this.state.leg.distanceMeters, durationSeconds: this.state.leg.durationSeconds } : null,
      materials: this.state.materials.filter(m => m.selected && m.text.trim()).map(m => ({ id: m.id, name: m.name, stopId: m.stopId, characters: m.text.length, access: 'read_material 도구로 필요한 원문만 읽는다.' })),
      note: '기존 경로 메모는 사용자가 준비한 맥락이며 실제 원본 자료/실차 측정과 다를 수 있다. selected 자료만 실제 읽은 발췌다.' };
  }
  world() {
    return { provenance: 'SIMULATED_ON_KAKAO_ROAD', authoritativeWithinJourney: true, time: new Date(this.state.worldTime).toISOString(), timeZone: 'Asia/Seoul', elapsedSeconds: Math.round(this.state.elapsedSeconds), position: this.state.position, motion: this.state.driving ? 'MOVING' : this.state.arrival ? 'STOPPED_AT_VISIT' : 'PAUSED', nextStop: this.target?.name || null, nextStopId: this.target?.id || null, arrival: this.state.arrival, remainingSeconds: this.state.leg ? Math.round(this.state.leg.durationSeconds * (1 - this.state.progress)) : null, progress: Math.round(this.state.progress * 1000) / 1000 };
  }
  private saveContext(notes = this.state.notes, materials = this.state.materials, preferences = this.state.preferences) {
    const all = JSON.parse(this.storage.getItem(storageKey) || '{}');
    this.storage.setItem(storageKey, JSON.stringify({ ...all, [this.state.route.id]: { notes, materials, preferences, heardCueIds: this.state.heardCueIds, cursor: this.cursor() } }));
    this.state.notes = notes; this.state.materials = materials; this.state.preferences = preferences; this.emit();
  }
  private cursor() { return { signature: JSON.stringify(this.state.route.stops.map(s => [s.id, s.latitude ?? s.lat, s.longitude ?? s.lng])), targetIndex: this.state.targetIndex, position: this.state.position, detours: [...this.detours], arrival: this.state.arrival, worldTime: this.state.worldTime, elapsedSeconds: this.state.elapsedSeconds }; }
  private saveCursor() {
    try { this.saveContext(); this.lastSaved = Date.now(); }
    catch { this.state.driving = false; this.state.roadError = '진행 상태를 저장하지 못해 모의 주행을 멈췄어요. 기존 계획과 원본은 보존돼 있어요.'; this.emit(); }
  }
  addNote(text: string) {
    if (!text.trim() || text.length > 500 || this.state.notes.length >= 40) throw new Error('기억은 500자, 경로마다 40개까지 저장할 수 있어요.');
    const note = { id: crypto.randomUUID(), text: text.trim() };
    this.saveContext([...this.state.notes, note]); return note;
  }
  forget(id: string) {
    if (!this.state.notes.some(n => n.id === id)) throw new Error('삭제할 기억이 없어요.');
    this.saveContext(this.state.notes.filter(n => n.id !== id)); return { ok: true };
  }
  updateNote(id: string, text: string) {
    if (!this.state.notes.some(n => n.id === id)) throw new Error('수정할 기억이 없어요.');
    if (!text.trim() || text.length > 500) throw new Error('기억은 1~500자로 적어 주세요.');
    const note = { id, text: text.trim() };
    this.saveContext(this.state.notes.map(n => n.id === id ? note : n)); return note;
  }
  setPreferences(input: Partial<CompanionPreferences>) {
    if (input.focus !== undefined && !['auto', 'work', 'travel', 'daily'].includes(input.focus)) throw new Error('동행 맥락을 확인해 주세요.');
    const preferences = { ...this.state.preferences, ...input, ...(input.goal !== undefined && input.focus === undefined ? { focus: focusFromGoal(input.goal) } : {}), goal: (input.goal ?? this.state.preferences.goal).trim().slice(0, 300) };
    this.saveContext(this.state.notes, this.state.materials, preferences);
    return { preferences, situation: this.situation };
  }
  markCueHeard(id: string) {
    if (this.state.heardCueIds.includes(id)) return;
    const old = this.state.heardCueIds;
    this.state.heardCueIds = [...old, id].slice(-60);
    try { this.saveContext(); } catch (error) { this.state.heardCueIds = old; throw error; }
  }
  registerPlace(place: Place) {
    if (!/^kakao:\d+$/.test(place.id) || !coordinateOf(place.coordinate) || place.source?.url !== 'https://place.map.kakao.com/' + place.id.slice(6)) throw new Error('확인된 장소만 연결할 수 있어요.');
    if (this.seenPlaces.size > 24) this.seenPlaces.delete(this.seenPlaces.keys().next().value!);
    this.seenPlaces.set(place.id, { place, at: Date.now(), revision: this.state.revision });
  }
  addMaterial(material: Material) {
    if (this.state.materials.length >= 12) throw new Error('한 경로에는 자료를 12개까지 연결할 수 있어요.');
    this.saveContext(this.state.notes, [...this.state.materials, material]);
  }
  selectMaterial(id: string, selected: boolean) { this.saveContext(this.state.notes, this.state.materials.map(m => m.id === id ? { ...m, selected } : m)); }
  removeMaterial(id: string) { this.saveContext(this.state.notes, this.state.materials.filter(m => m.id !== id)); }
  async search(query: string, signal: AbortSignal, scope: 'nearby' | 'name' = 'nearby') {
    if (!this.state.position) throw new Error('검색 기준 위치가 없어요. 좌표가 있는 경로를 선택해 주세요.');
    const revision = this.state.revision;
    const response = await fetch('/api/fallback/places', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, center: this.state.position, scope }), signal });
    const result = await response.json();
    if (!response.ok || result.status !== 'READY') throw new Error(result.error || result.reason || '장소 검색을 완료하지 못했어요.');
    signal.throwIfAborted();
    if (revision !== this.state.revision) throw new Error('검색 중 경로가 바뀌었어요. 다시 검색해 주세요.');
    const places: Place[] = (result.places || []).filter((p: Place) => typeof p.id === 'string' && typeof p.name === 'string' &&
      !!p.coordinate && coordinateOf(p.coordinate as RouteStop) && /^https:\/\/place.map.kakao.com\//.test(p.source?.url || '')).slice(0, 5);
    this.state.places = places;
    for (const place of places) this.registerPlace(place);
    this.emit();
    return { places, scope, distanceKind: '현재 차량 위치 기준 직선 거리. 도로 우회 시간은 제안에서 별도 계산.' };
  }
  async propose(placeId: string, signal: AbortSignal) {
    const entry = this.seenPlaces.get(placeId), s = this.state, target = this.target;
    if (!entry || entry.revision !== s.revision || Date.now() - entry.at > 5 * 60_000) throw new Error('최근 검색 결과에서 장소를 다시 선택해 주세요.');
    if (!s.position || !target || !coordinateOf(target)) throw new Error('현재 위치와 다음 방문지 좌표가 필요해요.');
    if (s.route.stops.length >= 32) throw new Error('방문지는 최대 32개까지 추가할 수 있어요.');
    const revision = s.revision, from = point('position', '모의 위치', { ...s.position }), to = point(target.id, target.name, coordinateOf(target)!);
    const [baseline, via] = await Promise.all([
      this.routeLoader([from, to], signal),
      this.routeLoader([from, point(entry.place.id, entry.place.name, entry.place.coordinate), to], signal),
    ]);
    signal.throwIfAborted();
    if (revision !== s.revision) throw new Error('계산 중 경로가 바뀌었어요. 다시 제안해 주세요.');
    if (s.position && meters(from, s.position) > 500) throw new Error('계산하는 동안 위치가 많이 바뀌었어요. 모의 주행을 잠시 멈추고 다시 제안해 주세요.');
    s.proposal = { id: crypto.randomUUID(), revision, place: entry.place, action: 'add', label: entry.place.name, extraSeconds: via.durationSeconds - baseline.durationSeconds, distanceMeters: via.distanceMeters, afterInput: this.latestInput.serial, from: { latitude: from.latitude, longitude: from.longitude }, expires: Date.now() + 120000, preview: via, beforeNames: [target.name], afterNames: [entry.place.name, target.name] };
    this.emit(); return { ok: true, state: 'WAITING_FOR_USER', proposal: { ...s.proposal, preview: undefined } };
  }
  async proposeSkip(stopId: string, signal: AbortSignal) {
    const s = this.state, index = s.route.stops.findIndex(stop => stop.id === stopId);
    if (index < s.targetIndex || index < 0) throw new Error('아직 방문하지 않은 곳만 건너뛸 수 있어요.');
    if (index === s.route.stops.length - 1) throw new Error('마지막 목적지는 남겨 두고 경로를 바꿔 주세요.');
    const next = s.route.stops[index === s.targetIndex ? index + 1 : s.targetIndex];
    if (!next || !s.position || !coordinateOf(next)) throw new Error('마지막 목적지는 남겨 두고 경로를 바꿔 주세요.');
    const revision = s.revision, from = { ...s.position }, stop = s.route.stops[index];
    const road = await this.routeLoader([point('position', '모의 위치', from), point(next.id, next.name, coordinateOf(next)!)], signal);
    signal.throwIfAborted();
    if (revision !== s.revision || !s.position || meters(from, s.position) > 500) throw new Error('진행 상황이 바뀌었어요. 다시 제안해 주세요.');
    s.proposal = { id: crypto.randomUUID(), revision, action: 'skip', label: stop.name, skipId: stop.id, extraSeconds: index === s.targetIndex && s.leg ? road.durationSeconds - s.leg.durationSeconds : 0, distanceMeters: road.distanceMeters, afterInput: this.latestInput.serial, from, expires: Date.now() + 120000, ...(index === s.targetIndex ? { preview: road } : {}), beforeNames: s.route.stops.slice(s.targetIndex).map(stop => stop.name), afterNames: s.route.stops.slice(s.targetIndex).filter(item => item.id !== stop.id).map(stop => stop.name) };
    this.emit(); return { ok: true, state: 'WAITING_FOR_USER', proposal: { ...s.proposal, preview: undefined } };
  }
  async proposeRoute(ids: string[], signal: AbortSignal, title?: string) {
    const s = this.state;
    if (!s.position || !ids.length || ids.length > 31 || ids.length + s.targetIndex > 32 || new Set(ids).size !== ids.length) throw new Error('중복 없이 앞으로 방문할 곳을 1~31개 골라 주세요.');
    const remaining = ids.map(id => {
      const existing = s.route.stops.slice(s.targetIndex).find(stop => stop.id === id);
      if (existing && coordinateOf(existing)) return existing;
      if (id === 'shortcut:home' && this.homePosition) return { id: crypto.randomUUID(), name: '집', ...this.homePosition };
      const entry = this.seenPlaces.get(id);
      if (!entry || entry.revision !== s.revision || Date.now() - entry.at > 300000) throw new Error('방문지 이름을 실제로 검색한 뒤 다시 제안해 주세요.');
      return { id: crypto.randomUUID(), name: entry.place.name, address: entry.place.address, ...entry.place.coordinate, poiId: entry.place.id, type: this.situation === 'work' ? 'business' as const : this.situation === 'travel' ? 'travel' as const : undefined };
    });
    if (remaining.every((stop, i) => stop.id === s.route.stops[s.targetIndex + i]?.id) && remaining.length === s.route.stops.length - s.targetIndex) throw new Error('지금과 같은 방문 순서예요.');
    const revision = s.revision, from = { ...s.position };
    const preview = await this.routeLoader([point('position', '모의 위치', from), ...remaining.map(stop => point(stop.id, stop.name, coordinateOf(stop)!))], signal);
    signal.throwIfAborted();
    if (revision !== s.revision || !s.position || meters(from, s.position) > 500) throw new Error('진행 상황이 바뀌었어요. 다시 제안해 주세요.');
    s.proposal = { id: crypto.randomUUID(), revision, action: 'route', label: title?.trim().slice(0, 100) || '방문 순서 변경', title: title?.trim().slice(0, 100), extraSeconds: 0, distanceMeters: preview.distanceMeters, preview, routeStops: [...s.route.stops.slice(0, s.targetIndex), ...remaining], beforeNames: s.route.stops.slice(s.targetIndex).map(stop => stop.name), afterNames: remaining.map(stop => stop.name), afterInput: this.latestInput.serial, from, expires: Date.now() + 120000 };
    this.emit(); return { ok: true, state: 'WAITING_FOR_USER', proposal: { ...s.proposal, preview: undefined } };
  }
  decide(id: string, decision: 'approve' | 'cancel', source: 'button' | 'voice') {
    const s = this.state, proposal = s.proposal;
    if (!proposal || proposal.id !== id || proposal.revision !== s.revision) throw new Error('이 변경안은 더 이상 유효하지 않아요.');
    if (Date.now() > proposal.expires || (s.position && meters(proposal.from, s.position) > 500)) { s.proposal = null; this.emit(); throw new Error('시간이나 위치가 바뀌어 다시 계산이 필요해요. 장소를 다시 제안해 주세요.'); }
    if (source === 'voice' && (this.latestInput.serial <= proposal.afterInput || approvalIntent(this.latestInput.text) !== decision))
      throw new Error('변경안을 보여드렸어요. 적용/취소 버튼 또는 명확한 새 승인으로 확인해 주세요.');
    if (decision === 'cancel') { s.proposal = null; this.emit(); return { ok: true, applied: false }; }
    const stops = [...s.route.stops];
    let addedId: string | undefined;
    if (proposal.action === 'route') {
      stops.splice(0, stops.length, ...proposal.routeStops!);
    } else if (proposal.action === 'skip') {
      const index = stops.findIndex(stop => stop.id === proposal.skipId);
      if (index < s.targetIndex) throw new Error('이미 지난 방문지는 바꿀 수 없어요.');
      stops.splice(index, 1);
    } else {
      const place = proposal.place!;
      const stop: RouteStop = { id: crypto.randomUUID(), name: place.name, address: place.address, ...place.coordinate, poiId: place.id, type: this.target?.type, category: '잠깐 경유' };
      stops.splice(s.targetIndex, 0, stop); addedId = stop.id;
    }
    const route = { ...s.route, stops, ...(proposal.title ? { title: proposal.title } : {}) };
    // Persist first. A storage failure leaves the proposal and existing route intact.
    this.persistRoute(route);
    this.lastChange = { route: s.route, targetIndex: s.targetIndex, revision: s.revision + 1, label: proposal.label };
    if (addedId) this.detours.add(addedId);
    this.legControl?.abort();
    s.route = route; s.revision++; s.proposal = null; s.leg = null; s.progress = 0; s.roadError = ''; s.arrival = null;
    this.seenPlaces.clear(); s.places = [];
    this.saveCursor();
    this.emit(); void this.loadLeg();
    return { ok: true, applied: true, target: this.target?.name, revision: s.revision, environment: 'BROWSER_PLAN_ONLY' };
  }
  undo() {
    if (!this.canUndo || !this.lastChange) throw new Error('방문 진행 전의 마지막 변경만 되돌릴 수 있어요.');
    const change = this.lastChange, s = this.state;
    this.persistRoute(change.route);
    this.legControl?.abort();
    s.route = change.route; s.targetIndex = change.targetIndex; s.revision++; s.proposal = null; s.leg = null; s.progress = 0; s.arrival = null;
    this.saveCursor();
    this.lastChange = undefined; this.seenPlaces.clear(); this.emit(); void this.loadLeg();
    return { ok: true, target: this.target?.name };
  }
  async restart() {
    const s = this.state;
    this.legControl?.abort(); s.driving = false; s.targetIndex = this.initialIndex; s.position = this.initialPosition; s.arrival = null; s.proposal = null; s.progress = 0; s.leg = null; s.revision++;
    // Explicit replay starts a new simulation run; reconnects still retain the heard ledger.
    s.heardCueIds = [];
    s.worldTime = Date.now(); s.elapsedSeconds = 0;
    this.lastChange = undefined; this.seenPlaces.clear(); this.saveCursor();
    this.emit(); await this.loadLeg();
    return { ok: true, restarted: true, environment: 'BROWSER_SIMULATION' };
  }
  async loadLeg() {
    this.legControl?.abort();
    const control = new AbortController(); this.legControl = control;
    const s = this.state, revision = s.revision, index = s.targetIndex, target = this.target;
    s.leg = null; s.progress = 0; s.roadError = ''; this.emit();
    if (!target) return;
    if (!s.position || !coordinateOf(target)) { s.roadError = '이 구간의 위치 좌표가 없어요. 휴대폰 준비 화면에서 좌표를 등록해 주세요.'; s.driving = false; this.emit(); return; }
    try {
      const road = await this.routeLoader([point('position', '모의 위치', s.position), point(target.id, target.name, coordinateOf(target)!)], control.signal);
      if (control.signal.aborted || revision !== s.revision || index !== s.targetIndex) return;
      s.leg = road; this.emit();
    } catch (error) {
      if (control.signal.aborted) return;
      s.driving = false; s.roadError = error instanceof Error ? error.message : '도로 경로를 계산하지 못했어요.'; this.emit();
    }
  }
  setDriving(driving: boolean) { if (driving && !this.state.leg) throw new Error('도로 경로를 계산한 뒤 주행을 시작할 수 있어요.'); this.state.driving = driving; if (driving) this.state.arrival = null; else this.saveCursor(); this.emit(); }
  advance(seconds: number) {
    const s = this.state;
    if (!s.driving || !s.leg || !this.target || !Number.isFinite(seconds) || seconds <= 0) return;
    const elapsed = Math.min(seconds, Math.max(0, (1 - s.progress) * s.leg.durationSeconds));
    s.worldTime += elapsed * 1000; s.elapsedSeconds += elapsed;
    s.progress = Math.min(1, s.progress + seconds / Math.max(1, s.leg.durationSeconds));
    s.position = positionOnRoad(s.leg, s.progress);
    if (Date.now() - this.lastSaved > 5000) this.saveCursor();
    if (s.progress >= 1) this.arrive(); else this.emit();
  }
  arrive() {
    if (!this.target) return;
    this.state.arrival = { name: this.target.name, detour: this.detours.has(this.target.id), nextName: this.state.route.stops[this.state.targetIndex + 1]?.name };
    const targetPosition = coordinateOf(this.target);
    if (targetPosition) this.state.position = targetPosition;
    this.state.driving = false; this.state.targetIndex++; this.state.leg = null; this.state.progress = 0;
    // Any proposal tied to the former segment is stale after arrival.
    this.state.revision++; this.state.proposal = null; this.seenPlaces.clear();
    this.saveCursor();
    this.emit(); void this.loadLeg();
  }
  async tool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (name === 'get_journey') return this.context();
    if (name === 'read_material') {
      const material = this.state.materials.find(m => m.id === args.material_id && m.selected && m.text.trim());
      if (!material) throw new Error('현재 선택한 읽을 수 있는 자료만 열 수 있어요.');
      return { id: material.id, name: material.name, stopId: material.stopId, excerpt: material.text.slice(0, 24000), truncated: material.text.length > 24000 };
    }
    if (name === 'search_places') return this.search(String(args.query || '').slice(0, 120), signal, args.scope === 'name' ? 'name' : 'nearby');
    if (name === 'propose_route') return this.proposeRoute(Array.isArray(args.stop_ids) ? args.stop_ids.filter((id): id is string => typeof id === 'string') : [], signal, typeof args.title === 'string' ? args.title : undefined);
    if (name === 'propose_stop') return this.propose(String(args.place_id || ''), signal);
    if (name === 'propose_skip_stop') return this.proposeSkip(String(args.stop_id || ''), signal);
    if (name === 'decide_proposal' && (args.decision === 'approve' || args.decision === 'cancel')) return this.decide(String(args.proposal_id || ''), args.decision, 'voice');
    if (name === 'remember') return this.addNote(String(args.text || ''));
    if (name === 'forget') return this.forget(String(args.note_id || ''));
    if (name === 'update_note') return this.updateNote(String(args.note_id || ''), String(args.text || ''));
    if (name === 'set_companion_preferences') return this.setPreferences({ ...(typeof args.goal === 'string' ? { goal: args.goal } : {}), ...(typeof args.quiet === 'boolean' ? { quiet: args.quiet } : {}), ...(typeof args.focus === 'string' ? { focus: args.focus as CompanionPreferences['focus'] } : {}) });
    if (name === 'undo_route_change') {
      if (!/(되돌|원래|원복)/.test(this.latestInput.text) || /[?？]/.test(this.latestInput.text)) throw new Error('되돌리기를 명확히 요청해 주세요.');
      return this.undo();
    }
    if (name === 'resume_journey') {
      if (!this.state.leg) await this.loadLeg();
      signal.throwIfAborted(); this.setDriving(true); return { ok: true, resumed: true, target: this.target?.name, environment: 'BROWSER_SIMULATION' };
    }
    throw new Error('지원하지 않는 도구예요.');
  }
}
