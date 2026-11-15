import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { BrowserJourney, approvalIntent, positionOnRoad } from './journey';
import type { SavedRoute } from '../types';
import type { RoadRoute } from '../components/phone/roadDirections';
const route: SavedRoute = { id: 'test-route', title: '검사 경로', date: '2099-01-01', isActiveInCar: false, stops: [
  { id: 'first', name: '첫 방문지', latitude: 37.5, longitude: 127, attachedDocumentIds: ['preserved-original'] },
  { id: 'last', name: '마지막 방문지', latitude: 37.6, longitude: 127.1 },
] };
const road: RoadRoute = { provider: 'KAKAO_DIRECTIONS', kind: 'DRIVING_ESTIMATE', distanceMeters: 1000, durationSeconds: 600, calculatedAt: new Date().toISOString(), lines: [[{ latitude: 37.4, longitude: 127 }, { latitude: 37.5, longitude: 127 }]] };
const place = { id: 'kakao:123', name: '검사 카페', coordinate: { latitude: 37.45, longitude: 127.01 }, source: { url: 'https://place.map.kakao.com/123' } };
const storage = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) || null, setItem: (k: string, v: string) => { data.set(k, v); } }; };
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });
function setup(persist: (r: SavedRoute) => void = () => {}, store = storage(), loader = async (points: unknown[], _signal: AbortSignal) => ({ ...road, durationSeconds: points.length === 3 ? 720 : 600 })) {
  const mock = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ status: 'READY', places: [place] }));
  restore = () => mock.mockRestore();
  const journey = new BrowserJourney(structuredClone(route), persist, store, loader, { latitude: 37.4, longitude: 127 });
  return { journey, store };
}
describe('browser journey decisions', () => {
  test('proposal uses provider time and does not mutate plan before approval', async () => {
    let writes = 0; const { journey } = setup(() => { writes++; });
    await journey.search('카페', new AbortController().signal);
    await journey.propose(place.id, new AbortController().signal);
    expect(journey.state.proposal?.extraSeconds).toBe(120);
    expect(journey.state.route.stops).toHaveLength(2); expect(writes).toBe(0);
    journey.decide(journey.state.proposal!.id, 'cancel', 'button');
    expect(journey.state.route.stops).toHaveLength(2); expect(writes).toBe(0);
  });
  test('model cannot approve from stale/ambiguous input; fresh approval persists originals and inserts once', async () => {
    let saved: SavedRoute | undefined; const { journey } = setup(r => { saved = r; });
    journey.recordInput('네');
    await journey.search('카페', new AbortController().signal); await journey.propose(place.id, new AbortController().signal);
    const id = journey.state.proposal!.id;
    expect(() => journey.decide(id, 'approve', 'voice')).toThrow();
    journey.recordInput('좋아?'); expect(() => journey.decide(id, 'approve', 'voice')).toThrow();
    journey.recordInput('응'); journey.decide(id, 'approve', 'voice');
    expect(saved!.stops[0].name).toBe(place.name);
    expect(saved!.stops[1].attachedDocumentIds).toEqual(['preserved-original']);
    expect(() => journey.decide(id, 'approve', 'button')).toThrow();
  });
  test('plan quota failure preserves proposal and original path', async () => {
    const { journey } = setup(() => { throw new Error('quota'); });
    await journey.search('카페', new AbortController().signal); await journey.propose(place.id, new AbortController().signal);
    expect(() => journey.decide(journey.state.proposal!.id, 'approve', 'button')).toThrow('quota');
    expect(journey.state.proposal).not.toBeNull(); expect(journey.state.route.stops).toHaveLength(2);
  });
  test('only real search IDs are eligible, cancelled async work cannot publish a proposal', async () => {
    const { journey } = setup();
    await expect(journey.propose('fabricated', new AbortController().signal)).rejects.toThrow();
    await journey.search('카페', new AbortController().signal);
    const control = new AbortController(); control.abort();
    await expect(journey.propose(place.id, control.signal)).rejects.toThrow();
    expect(journey.state.proposal).toBeNull();
  });
  test('route change during asynchronous calculation rejects an obsolete proposal', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const { journey } = setup(undefined, storage(), async () => { await blocked; return road; });
    await journey.search('카페', new AbortController().signal);
    const calculation = journey.propose(place.id, new AbortController().signal);
    journey.arrive(); release();
    await expect(calculation).rejects.toThrow('경로가 바뀌었어요');
    expect(journey.state.proposal).toBeNull(); journey.dispose();
  });
});
describe('memory, materials and cursor', () => {
  test('memory CRUD and material selection survive reload; only selected excerpts enter model context', () => {
    const { journey, store } = setup();
    const note = journey.addNote('디카페인');
    journey.updateNote(note.id, '커피는 디카페인');
    journey.addMaterial({ id: 'doc1', name: 'notes.txt', text: 'selected source', selected: true, stopId: 'first' });
    journey.addMaterial({ id: 'doc2', name: 'private.txt', text: 'excluded secret', selected: false, stopId: 'first' });
    expect(JSON.stringify(journey.context())).not.toContain('excluded secret');
    const reloaded = new BrowserJourney(route, () => {}, store);
    expect(reloaded.state.notes[0].text).toBe('커피는 디카페인');
    reloaded.forget(note.id); expect(reloaded.state.notes).toHaveLength(0);
    reloaded.selectMaterial('doc1', false); expect(reloaded.context().materials).toHaveLength(0);
  });
  test('storage errors do not claim a memory was stored', () => {
    const { journey } = setup(undefined, { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    expect(() => journey.addNote('lost')).toThrow(); expect(journey.state.notes).toHaveLength(0);
  });
  test('simulated position follows road and resumes paused after reload', async () => {
    const { journey, store } = setup();
    await journey.loadLeg(); journey.setDriving(true); journey.advance(300); journey.setDriving(false);
    expect(journey.state.position!.latitude).toBeCloseTo(37.45, 3);
    const reloaded = new BrowserJourney(route, () => {}, store);
    expect(reloaded.state.position!.latitude).toBeCloseTo(37.45, 3); expect(reloaded.state.driving).toBe(false);
  });
  test('disconnected road lines are not interpolated across their gap', () => {
    const lines = [[{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 }], [{ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1.001 }]];
    const position = positionOnRoad({ ...road, lines }, 0.7)!;
    expect(position.latitude).toBe(1);
  });
  test('mixed or negative approval is never an affirmative', () => {
    for (const text of ['응 아니 취소', '좋아 보이는데?', '가지 마', '안 좋아']) expect(approvalIntent(text)).not.toBe('approve');
    for (const text of ['응 그렇게 바꿔줘', '그 경로로 바꿔', '네 그렇게 해주세요']) expect(approvalIntent(text)).toBe('approve');
    expect(approvalIntent('아니 그대로 가')).toBe('cancel');
  });
});
