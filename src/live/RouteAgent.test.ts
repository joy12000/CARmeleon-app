import { expect, test } from 'bun:test';
import { RouteAgent } from './RouteAgent';
import { BrowserJourney } from './journey';
import type { AgentResult } from './agentProtocol';
const route = { id: 'agent-r', title: '구경과 커피', date: '2099-01-01', isTravel: true, isActiveInCar: false, stops: [{ id: 't', name: '관광지', latitude: 37.5, longitude: 127 }, { id: 'home', name: '집', latitude: 37.4, longitude: 127 }] };
const place = { id: 'kakao:123', name: '가는 길 카페', coordinate: { latitude: 37.45, longitude: 127.01 }, source: { url: 'https://place.map.kakao.com/123' } };
const result: AgentResult = { plan: { outcome: 'suggest_stop', topic: 'coffee', goal: '덜 돌아가는 카페에 들르기', reason: '실제 도로 비교', speech: '이 카페는 3분 정도 돌아가요. 들를까요?', placeId: place.id, sourceIds: [place.id] }, places: [place], comparisons: [{ placeId: place.id, extraSeconds: 180, distanceMeters: 1000 }], sources: [{ id: place.id, title: place.name, url: place.source.url }], trace: { tools: ['search_near_route', 'compare_detours', 'finish_attention'], rounds: 3 } };
function setup(value = result) {
  const data = new Map<string, string>(); const storage = { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const journey = new BrowserJourney(route, () => {}, storage, async () => ({ provider: 'KAKAO_DIRECTIONS', kind: 'DRIVING_ESTIMATE', calculatedAt: new Date().toISOString(), distanceMeters: 1000, durationSeconds: 600, lines: [[{ latitude: 37.4, longitude: 127 }, { latitude: 37.5, longitude: 127 }]] }), { latitude: 37.4, longitude: 127 });
  let requests = 0;
  const agent = new RouteAgent(route.id, storage, async () => { requests++; return Response.json(value); });
  return { journey, agent, storage, requests: () => requests };
}

test('agent-owned work persists from preparation through approval and arrival; no GPS model loop', async () => {
  const { journey, agent, storage, requests } = setup(); await journey.loadLeg(); journey.setDriving(true);
  await agent.observe(journey, []); expect(agent.current?.status).toBe('ready');
  await agent.observe(journey, []); expect(requests()).toBe(1);
  await agent.present(journey); expect(agent.current?.status).toBe('awaiting_approval'); expect(journey.state.route.stops).toHaveLength(2);
  journey.decide(journey.state.proposal!.id, 'approve', 'button'); agent.sync(journey);
  expect(agent.current?.status).toBe('in_route');
  const resumed = new RouteAgent(route.id, storage); expect(resumed.current?.goal).toBe('덜 돌아가는 카페에 들르기');
  journey.arrive(); resumed.sync(journey); expect(resumed.current).toBeUndefined(); expect(resumed.tasks[0].status).toBe('done');
});

test('a rejected autonomous proposal is remembered as dismissed rather than completed', async () => {
  const { journey, agent } = setup(); await journey.loadLeg(); journey.setDriving(true);
  await agent.observe(journey, []); await agent.present(journey);
  journey.decide(journey.state.proposal!.id, 'cancel', 'button'); agent.sync(journey);
  expect(agent.tasks[0].status).toBe('dismissed'); expect(journey.state.route.stops).toHaveLength(2);
});

test('business confirmation waits for a new user answer; playback alone does not finish the task', async () => {
  const ask: AgentResult = { ...result, plan: { outcome: 'ask', topic: 'visit_check', goal: '납기 확인', reason: '자료와 메모 충돌', speech: '18일과 28일 중 어느 날짜로 협의할까요?', sourceIds: ['visit'] } };
  const { journey, agent } = setup(ask); await journey.loadLeg(); journey.setDriving(true);
  await agent.observe(journey, []); await agent.present(journey);
  const id = agent.current!.id; expect(agent.current!.status).toBe('waiting_answer');
  expect(() => agent.resolve(id, 'done', [])).toThrow();
  agent.resolve(id, 'done', [{ id: 'answer1', role: 'user', text: '18일로 협의하자' }]);
  expect(agent.tasks[0].status).toBe('done');
});

test('quiet and paused journeys do not investigate; sensitive task reset drops stored excerpts', async () => {
  const { journey, agent, storage, requests } = setup(); await journey.loadLeg();
  await agent.observe(journey, []); expect(requests()).toBe(0);
  journey.setDriving(true); journey.setPreferences({ quiet: true }); await agent.observe(journey, []); expect(requests()).toBe(0);
  journey.setPreferences({ quiet: false }); await agent.observe(journey, []); expect(agent.tasks).toHaveLength(1);
  agent.clearSensitive(); expect(agent.tasks).toHaveLength(0); expect(new RouteAgent(route.id, storage).tasks).toHaveLength(0);
});
