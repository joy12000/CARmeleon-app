import { expect, test } from 'bun:test';
import { BrowserJourney, type Place } from './journey';
import { chooseCue, CompanionQueue, demoPlaybackSpeed, nearestRoadPoint, type CompanionCue } from './companion';
import { defaultPreferences, focusFromGoal, situationFor } from './situation';
import type { SavedRoute } from '../types';
import type { RoadRoute } from '../components/phone/roadDirections';
import { checkEncounter, encounterIntroduction } from './encounter';
import { positionOnRoad } from './journey';
const route: SavedRoute = { id: 'companion-test', title: '일과 여행', date: '2099-01-01', isBusiness: true, isTravel: true, isActiveInCar: false, stops: [
  { id: 'meeting', name: '미팅', type: 'business', latitude: 0, longitude: .01, attachedDocumentIds: ['original'] },
  { id: 'trip', name: '여행지', type: 'travel', latitude: 0, longitude: .02 },
  { id: 'home', name: '집', latitude: 0, longitude: .03 },
] };
const road: RoadRoute = { provider: 'KAKAO_DIRECTIONS', kind: 'DRIVING_ESTIMATE', calculatedAt: new Date().toISOString(), distanceMeters: 1100, durationSeconds: 1000, lines: [[{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: .01 }]] };
const place: Place = { id: 'kakao:123', name: '가는 길 공원', coordinate: { latitude: .0003, longitude: .004 }, source: { url: 'https://place.map.kakao.com/123' } };
function store() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); } }; }
function setup() {
  const storage = store(); const writes: SavedRoute[] = [];
  const journey = new BrowserJourney(structuredClone(route), value => { writes.push(value); }, storage, async () => road, { latitude: 0, longitude: 0 });
  journey.state.leg = road;
  return { journey, storage, writes };
}
test('mixed trip adapts per stop, selected travel guides remain travel, home is daily', () => {
  expect(situationFor(route, route.stops[0], true, defaultPreferences)).toBe('work');
  expect(situationFor(route, route.stops[1], true, defaultPreferences)).toBe('travel');
  expect(situationFor(route, route.stops[2], false, defaultPreferences)).toBe('daily');
  expect(focusFromGoal('회의 준비에 집중')).toBe('work');
  expect(focusFromGoal('미팅 끝나고 여행')).toBe('auto');
});
test('purpose and quiet preference persist; other stop originals do not enter automatic briefing', () => {
  const { journey, storage } = setup();
  journey.addMaterial({ id: 'a', name: 'meeting.txt', stopId: 'meeting', selected: true, text: '307만원' });
  journey.addMaterial({ id: 'b', name: 'travel.txt', stopId: 'trip', selected: true, text: '다른 방문지 자료' });
  expect(journey.targetMaterials.map(m => m.id)).toEqual(['a']);
  journey.setPreferences({ goal: '오늘은 나들이', quiet: true });
  expect(journey.situation).toBe('travel');
  const reloaded = new BrowserJourney(route, () => {}, storage);
  expect(reloaded.state.preferences).toEqual({ goal: '오늘은 나들이', quiet: true, focus: 'travel' });
});
test('skip requires approval, undo restores originals and retains present position', async () => {
  const { journey, writes } = setup();
  await journey.proposeSkip('meeting', new AbortController().signal);
  expect(writes).toHaveLength(0); expect(journey.target!.id).toBe('meeting');
  journey.decide(journey.state.proposal!.id, 'approve', 'button');
  expect(journey.target!.id).toBe('trip'); expect(writes).toHaveLength(1);
  journey.state.position = { latitude: 0, longitude: .003 };
  journey.undo();
  expect(journey.target!.id).toBe('meeting');
  expect(journey.state.route.stops[0].attachedDocumentIds).toEqual(['original']);
  expect(journey.state.position!.longitude).toBe(.003);
  expect(() => journey.undo()).toThrow();
});
test('completed progress invalidates undo; final destination cannot be skipped', async () => {
  const { journey } = setup();
  await journey.proposeSkip('meeting', new AbortController().signal);
  journey.decide(journey.state.proposal!.id, 'approve', 'button');
  journey.arrive(); expect(() => journey.undo()).toThrow();
  journey.state.targetIndex = journey.state.route.stops.length - 1;
  await expect(journey.proposeSkip(journey.target!.id, new AbortController().signal)).rejects.toThrow();
});
test('a temporary detour arrives and resumes toward the original target', async () => {
  const { journey } = setup();
  journey.registerPlace(place);
  await journey.propose(place.id, new AbortController().signal);
  journey.decide(journey.state.proposal!.id, 'approve', 'button');
  expect(journey.target!.name).toBe(place.name);
  journey.arrive();
  expect(journey.state.arrival).toMatchObject({ name: place.name, detour: true, nextName: '미팅' });
  await journey.tool('resume_journey', {}, new AbortController().signal);
  expect(journey.state.driving).toBe(true); expect(journey.target!.id).toBe('meeting');
});
test('only completed speech is retained as a heard cue across sessions', () => {
  const { journey, storage } = setup();
  journey.markCueHeard('cue-source-v1'); journey.markCueHeard('cue-source-v1');
  expect(new BrowserJourney(route, () => {}, storage).state.heardCueIds).toEqual(['cue-source-v1']);
});
const prepared = { speech: '원문에 따르면 이번 만남에서는 계약 기간을 확인하면 돼요.', sources: [{ title: 'meeting.txt' }], grounded: true, createdAt: new Date().toISOString() };
function cue(): CompanionCue { return { id: 'cue', kind: 'work', topic: '회의', anchor: 1, prepared, state: 'ready' }; }
const timing = { progress: .75, duration: 1000, speed: 1, quiet: false, idle: true, sinceUser: 20000, sinceSpeech: 25000 };
test('proactive speech yields to a human, ongoing output, quiet, and short windows', () => {
  expect(chooseCue([cue()], timing)?.id).toBe('cue');
  for (const input of [{ quiet: true }, { idle: false }, { sinceUser: 5000 }, { sinceSpeech: 5000 }]) expect(chooseCue([cue()], { ...timing, ...input })).toBeUndefined();
  const late = cue(); expect(chooseCue([late], { ...timing, progress: .999 })).toBeUndefined(); expect(late.state).toBe('skipped');
});
test('route projection rejects far-away places and disconnected-line gaps', () => {
  expect(nearestRoadPoint(road, place.coordinate).distance).toBeLessThan(150);
  expect(nearestRoadPoint(road, { latitude: .1, longitude: .004 }).distance).toBeGreaterThan(10000);
  const split = { ...road, lines: [[{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: .001 }], [{ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1.001 }]] };
  expect(nearestRoadPoint(split, { latitude: .5, longitude: .5 }).distance).toBeGreaterThan(50000);
});
test('preparation is scoped to the current stop; cancelling and clearing drops private text references', async () => {
  const { journey } = setup();
  journey.addMaterial({ id: 'a', name: 'meeting.txt', stopId: 'meeting', selected: true, text: '307만원' });
  journey.addMaterial({ id: 'b', name: 'other.txt', stopId: 'trip', selected: true, text: 'EXCLUDE_THIS_PRIVATE_TEXT' });
  let body = '';
  const queue = new CompanionQueue(async (_url, init) => { body = String(init?.body); return Response.json(prepared); });
  await queue.prepare(journey, new AbortController().signal);
  expect(body).toContain('307'); expect(body).not.toContain('EXCLUDE_THIS_PRIVATE_TEXT');
  expect(queue.claim({ ...timing, progress: .1, leadSpeed: 30 })?.prepared?.speech).toContain('계약');
  expect(queue.claim(timing)).toBeUndefined();
  queue.finish(false); queue.clear();
  expect(queue.lastCue).toBeUndefined(); expect(queue.cues).toHaveLength(0);
  const control = new AbortController(); control.abort();
  await queue.prepare(journey, control.signal); expect(queue.cues.some(c => c.state === 'ready')).toBe(false);
});
test('at most two upcoming travel cues use only real places close to the provider road', async () => {
  const { journey } = setup(); journey.setPreferences({ focus: 'travel' });
  const queue = new CompanionQueue(async url => String(url).endsWith('/places')
    ? Response.json({ status: 'READY', places: [place, { ...place, id: 'kakao:999', name: '멀리 있는 곳', coordinate: { latitude: .1, longitude: .004 }, source: { url: 'https://place.map.kakao.com/999' } }] })
    : Response.json({ ...prepared, sources: [{ title: '공식 정보', url: 'https://example.org' }] }));
  await queue.prepare(journey, new AbortController().signal);
  expect(queue.cues).toHaveLength(2);
  expect(queue.cues[0].place!.id).toBe(place.id);
  expect(journey.state.places).toHaveLength(0);
  const next = queue.claim({ ...timing, progress: .3, road, position: positionOnRoad(road, .3) });
  expect(next!.topic).toBe(place.name);
});

test('joint multi-stop planning previews real roads and applies only a fresh approval', async () => {
  const { journey, writes, storage } = setup();
  const second = { ...place, id: 'kakao:456', name: '둘째 공원', coordinate: { latitude: 0, longitude: .008 }, source: { url: 'https://place.map.kakao.com/456' } };
  journey.registerPlace(place); journey.registerPlace(second);
  await journey.proposeRoute([place.id, second.id, 'shortcut:home'], new AbortController().signal, '새 나들이');
  expect(writes).toHaveLength(0); expect(journey.state.route.stops[0].id).toBe('meeting');
  expect(journey.state.proposal?.preview?.provider).toBe('KAKAO_DIRECTIONS');
  expect(journey.context().proposal?.preview).toBeUndefined();
  expect(() => journey.decide(journey.state.proposal!.id, 'approve', 'voice')).toThrow();
  journey.recordInput('응'); journey.decide(journey.state.proposal!.id, 'approve', 'voice');
  expect(writes[0].title).toBe('새 나들이'); expect(writes[0].stops.map(stop => stop.name)).toEqual([place.name, second.name, '집']);
  expect(new BrowserJourney(writes[0], () => {}, storage).state.targetIndex).toBe(0);
});

test('manual reordering preserves completed prefix, document references and cursor on reload', async () => {
  const { journey, storage, writes } = setup();
  journey.arrive(); await journey.loadLeg();
  const current = { ...journey.state.position! };
  await journey.proposeRoute(['home', 'trip'], new AbortController().signal);
  journey.decide(journey.state.proposal!.id, 'approve', 'button');
  expect(journey.state.route.stops.map(stop => stop.id)).toEqual(['meeting', 'home', 'trip']);
  expect(journey.state.route.stops[0].attachedDocumentIds).toEqual(['original']);
  const reloaded = new BrowserJourney(writes[writes.length - 1], () => {}, storage);
  expect(reloaded.state.targetIndex).toBe(1); expect(reloaded.state.position).toEqual(current);
  journey.undo(); expect(journey.state.route.stops.map(stop => stop.id)).toEqual(['meeting', 'trip', 'home']);
});

test('invented, repeated and already visited places cannot enter a route proposal', async () => {
  const { journey } = setup();
  for (const ids of [['kakao:999'], ['meeting', 'meeting'], []]) await expect(journey.proposeRoute(ids, new AbortController().signal)).rejects.toThrow();
  journey.arrive();
  await expect(journey.proposeRoute(['meeting', 'home'], new AbortController().signal)).rejects.toThrow();
  await expect(journey.proposeSkip('home', new AbortController().signal)).rejects.toThrow();
});

test('explicit replay preserves route, original and memory and starts a fresh story run', async () => {
  const { journey, storage } = setup();
  journey.addNote('보존할 기억'); journey.addMaterial({ id: 'a', name: 'original.txt', stopId: 'meeting', selected: true, text: '원문' });
  journey.markCueHeard('completed-story');
  journey.arrive(); journey.arrive(); journey.arrive();
  expect(journey.target).toBeUndefined();
  await journey.restart();
  expect(journey.target!.id).toBe('meeting'); expect(journey.state.position).toEqual(journey.initialPosition); expect(journey.state.driving).toBe(false);
  expect(journey.state.notes[0].text).toBe('보존할 기억'); expect(journey.state.materials[0].text).toBe('원문'); expect(journey.state.heardCueIds).toEqual([]);
  expect(new BrowserJourney(route, () => {}, storage).state.targetIndex).toBe(0);
});

test('other stop originals are metadata until explicitly read; deselected originals cannot be retrieved', async () => {
  const { journey } = setup();
  journey.addMaterial({ id: 'other', name: '다른 방문지.txt', stopId: 'trip', selected: true, text: 'OTHER_STOP_PRIVATE_DETAIL' });
  expect(JSON.stringify(journey.context())).not.toContain('OTHER_STOP_PRIVATE_DETAIL');
  expect(journey.context().materials[0].name).toBe('다른 방문지.txt');
  expect(JSON.stringify(await journey.tool('read_material', { material_id: 'other' }, new AbortController().signal))).toContain('OTHER_STOP_PRIVATE_DETAIL');
  journey.selectMaterial('other', false);
  await expect(journey.tool('read_material', { material_id: 'other' }, new AbortController().signal)).rejects.toThrow();
});

test('automatic demo keeps a short route alive for unsolicited speech; manual fast mode may skip', () => {
  const base = { selected: 30, automatic: true, duration: 300, progress: .1, cues: [cue()], preparing: false, busy: false, quiet: false, sinceUser: 30000, sinceSpeech: 30000 };
  expect(demoPlaybackSpeed(base)).toBe(1);
  expect(demoPlaybackSpeed({ ...base, progress: 0 })).toBe(30);
  expect(demoPlaybackSpeed({ ...base, automatic: false })).toBe(30);
  expect(demoPlaybackSpeed({ ...base, quiet: true })).toBe(30);
  expect(demoPlaybackSpeed({ ...base, busy: true })).toBe(1);
  expect(chooseCue([cue()], { ...timing, progress: .1, duration: 300, speed: 1, leadSpeed: 30 })?.id).toBe('cue');
  expect(chooseCue([cue()], { ...timing, progress: .95, duration: 300, speed: 30 })).toBeUndefined();
});

test('business proactively prepares from saved visit memo without requiring a document or a question', async () => {
  const { journey } = setup();
  journey.state.route.stops[0].memo = '이번에는 가격보다 납기를 먼저 확인';
  let request: Record<string, unknown> = {};
  const queue = new CompanionQueue(async (_url, init) => { request = JSON.parse(String(init?.body)); return Response.json(prepared); });
  await queue.prepare(journey, new AbortController().signal);
  expect(queue.cues).toHaveLength(1); expect(queue.cues[0].state).toBe('ready');
  expect(JSON.stringify(request)).toContain('가격보다 납기'); expect(request.materials).toEqual([]);
});

test('journey world time advances with traveled seconds and persists across pause/reload', async () => {
  const { journey, storage } = setup(); await journey.loadLeg();
  const start = journey.state.worldTime;
  journey.setDriving(true); journey.advance(60); journey.setDriving(false);
  expect(journey.world().elapsedSeconds).toBe(60); expect(journey.state.worldTime - start).toBe(60000);
  expect(journey.world().motion).toBe('PAUSED');
  const reloaded = new BrowserJourney(route, () => {}, storage);
  expect(reloaded.state.worldTime).toBe(journey.state.worldTime); expect(reloaded.world().elapsedSeconds).toBe(60);
  reloaded.advance(-3); expect(reloaded.world().elapsedSeconds).toBe(60);
});

function roadside(): CompanionCue {
  return { id: 'encounter', kind: 'travel', topic: '연무대', anchor: .6, state: 'ready',
    prepared: { ...prepared, speech: '군사들이 무예를 연마하던 훈련장이에요.' },
    encounter: { kind: 'roadside', name: '연무대', coordinate: { latitude: -.0004, longitude: .006 } } };
}
const located = (progress: number, geometry = road) => ({ ...timing, progress, road: geometry, position: positionOnRoad(geometry, progress) });

test('travel narration cannot start kilometers early or without a current matched position, even at 30x lead', () => {
  const longRoad = { ...road, distanceMeters: 11000, durationSeconds: 2000, lines: [[{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: .1 }]] };
  const cue = roadside(); cue.encounter!.coordinate.longitude = .06;
  expect(chooseCue([cue], { ...located(.45, longRoad), leadSpeed: 30 })).toBeUndefined();
  expect(checkEncounter(cue, located(.45, longRoad)).evidence!.distanceMeters).toBeGreaterThan(1500);
  expect(chooseCue([roadside()], { ...timing, progress: .4 })).toBeUndefined();
  expect(chooseCue([roadside()], { ...located(.4), position: { latitude: .01, longitude: .004 } })).toBeUndefined();
});

test('roadside speech names the place and vehicle-relative side from geometry, not an assumed view', () => {
  const cue = roadside(), hit = chooseCue([cue], located(.52));
  expect(hit).toBe(cue); expect(cue.encounterEvidence!.distanceMeters).toBeLessThanOrEqual(250);
  expect(cue.encounterEvidence!.side).toBe('right'); expect(cue.spokenText).toStartWith('오른편 가까이에 연무대가 있어요.');
  expect(cue.encounterEvidence!.visibility).toBe('NOT_OBSERVED'); expect(cue.spokenText).not.toContain('보이');
  const reversed = { ...road, lines: road.lines.map(line => [...line].reverse()) };
  const reverseCue = roadside(); reverseCue.anchor = .4;
  const reverse = chooseCue([reverseCue], located(.32, reversed));
  expect(reverse!.encounterEvidence!.side).toBe('left'); expect(reverse!.spokenText).toStartWith('왼편 가까이에');
});

test('passing a landmark drops the stale story and also expires scheduled playback', async () => {
  const cue = roadside(); expect(chooseCue([cue], located(.61))).toBeUndefined(); expect(cue.state).toBe('skipped');
  const queue = new CompanionQueue(); queue.lastCue = { ...roadside(), state: 'scheduled' };
  expect(queue.expired(located(.4))).toBe(false); expect(queue.expired(located(.61))).toBe(true);
});

test('destination facts are introduced only on the final 200m approach, distinct from a roadside view', () => {
  const cue: CompanionCue = { ...roadside(), anchor: 1, encounter: { kind: 'destination', name: '정지영커피', coordinate: road.lines[0][1] } };
  expect(chooseCue([cue], { ...located(.6), leadSpeed: 30 })).toBeUndefined();
  expect(chooseCue([cue], located(.85))?.spokenText).toStartWith('곧 도착할 정지영커피 이야기예요.');
  expect(encounterIntroduction(cue.encounterEvidence!)).not.toContain('오른');
});

test('automatic demo slows near an encounter rather than making a distant story early; manual fast playback skips', () => {
  const base = { selected: 30, automatic: true, duration: road.durationSeconds, cues: [roadside()], preparing: false, busy: false, quiet: false, sinceUser: 30000, sinceSpeech: 30000 };
  expect(demoPlaybackSpeed({ ...base, ...located(.1) })).toBe(30);
  expect(demoPlaybackSpeed({ ...base, ...located(.4) })).toBe(1);
  expect(demoPlaybackSpeed({ ...base, ...located(.4), automatic: false })).toBe(30);
  const fast = roadside(); expect(chooseCue([fast], { ...located(.4), speed: 30 })).toBeUndefined(); expect(fast.state).toBe('skipped');
});
