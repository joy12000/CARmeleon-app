import { expect, test } from 'bun:test';
import { GenerateContentResponse } from '@google/genai';
import { createRouteAgent } from './agent';
import { KakaoLocalPlaces } from '../agent/places';
import type { AgentObservation } from '../../src/live/agentProtocol';
const input: AgentObservation = { event: 'departure', routeId: 'r', revision: 1, targetId: 'm', situation: 'work', goal: '납기 확인', routeTitle: '미팅', position: { latitude: 37.4, longitude: 127 }, ahead: { latitude: 37.45, longitude: 127 }, target: { id: 'm', name: '미팅', coordinate: { latitude: 37.5, longitude: 127 }, memo: '납기 18일' }, upcoming: [{ id: 'm', name: '미팅' }], notes: [], materials: [{ id: 'doc', name: '제안서.txt', text: 'PRIVATE_ACTUAL_SOURCE 납기는 28일' }], conversation: [], handledTopics: [] };
function call(name: string, args: Record<string, unknown>) { const response = new GenerateContentResponse(); response.candidates = [{ content: { role: 'model', parts: [{ functionCall: { name, args, id: name + '1' }, thoughtSignature: 'keep-signature' }] } }]; return response; }
const road = { provider: 'KAKAO_DIRECTIONS' as const, kind: 'DRIVING_ESTIMATE' as const, calculatedAt: new Date().toISOString(), distanceMeters: 1000, durationSeconds: 600, lines: [[input.position, input.target.coordinate]] };
const places = new KakaoLocalPlaces({});
const plan = { outcome: 'ask', topic: 'visit_check', goal: '실제 납품일 확인', reason: '메모와 제안서의 날짜가 다름', speech: '메모는 18일인데 제안서는 28일이에요. 어느 날짜로 협의할까요?', sourceIds: ['visit', 'doc'] };

test('agent reads actual selected source then forms an actionable question; model signatures survive tool turn', async () => {
  let rounds = 0;
  const agent = createRouteAgent(undefined, { places, directions: { route: async () => road }, generate: async contents => {
    if (!rounds++) { expect(JSON.stringify(contents)).not.toContain('PRIVATE_ACTUAL_SOURCE'); return call('read_material', { material_id: 'doc' }); }
    expect(JSON.stringify(contents)).toContain('PRIVATE_ACTUAL_SOURCE'); expect(JSON.stringify(contents)).toContain('keep-signature');
    return call('finish_attention', plan);
  } });
  const result = await agent(input, new AbortController().signal);
  expect(result.plan.outcome).toBe('ask'); expect(result.trace.tools).toEqual(['read_material', 'finish_attention']);
  expect(result.sources.map(s => s.title)).toContain('제안서.txt');
});

test('fabricated or unestimated places cannot become autonomous route suggestions', async () => {
  const agent = createRouteAgent(undefined, { places, directions: { route: async () => road }, generate: async () => call('finish_attention', { ...plan, outcome: 'suggest_stop', topic: 'coffee', sourceIds: ['visit'], placeId: 'kakao:invented' }) });
  await expect(agent(input, new AbortController().signal)).rejects.toThrow('도로 우회');
});

test('real search and several actual road comparisons precede a route suggestion', async () => {
  let rounds = 0, estimates = 0, query = '';
  const realProviderContract = new KakaoLocalPlaces({ kakaoLocalRestApiKey: 'test' }, async url => { query = new URL(String(url)).searchParams.get('query')!; return Response.json({ documents: [{ id: '123', place_name: '검사 카페', x: '127.01', y: '37.45', place_url: 'https://place.map.kakao.com/123' }, { id: '456', place_name: '다른 카페', x: '127.02', y: '37.46', place_url: 'https://place.map.kakao.com/456' }] }); });
  const agent = createRouteAgent(undefined, { places: realProviderContract, directions: { route: async raw => { estimates++; return { ...road, durationSeconds: (raw as { points: unknown[] }).points.length === 3 ? 750 : 600 }; } }, generate: async () => {
    if (!rounds++) return call('search_near_route', { category: 'coffee', at: 'ahead' });
    if (rounds === 2) return call('compare_detours', { place_ids: ['kakao:123', 'kakao:456'] });
    return call('finish_attention', { ...plan, outcome: 'suggest_stop', topic: 'coffee', sourceIds: ['kakao:123'], placeId: 'kakao:123' });
  } });
  const result = await agent({ ...input, situation: 'travel', goal: '가는 길에 커피를 마시고 싶어' }, new AbortController().signal);
  expect(query).toBe('카페'); expect(estimates).toBe(3); expect(result.comparisons).toHaveLength(2); expect(result.comparisons[0].extraSeconds).toBe(150);
  expect(result.plan.placeId).toBe('kakao:123');
});

test('handled topics and missing source references cannot be presented as new work', async () => {
  const agent = createRouteAgent(undefined, { places, directions: { route: async () => road }, generate: async () => call('finish_attention', { ...plan, sourceIds: ['visit'] }) });
  await expect(agent({ ...input, handledTopics: ['visit_check'] }, new AbortController().signal)).rejects.toThrow('이미 챙긴');
  const unread = createRouteAgent(undefined, { places, directions: { route: async () => road }, generate: async () => call('finish_attention', plan) });
  await expect(unread(input, new AbortController().signal)).rejects.toThrow('sourceIds');
});

test('cancellation and bounded rounds stop an unfinished investigation without inventing success', async () => {
  let rounds = 0;
  const agent = createRouteAgent(undefined, { places, directions: { route: async () => road }, generate: async () => { rounds++; return call('read_material', { material_id: 'missing' }); } });
  const cancelled = new AbortController(); cancelled.abort();
  await expect(agent(input, cancelled.signal)).rejects.toThrow(); expect(rounds).toBe(0);
  await expect(agent(input, new AbortController().signal)).rejects.toThrow('조사 범위'); expect(rounds).toBe(8);
});

test('a visit confirmation cannot be completed as a one-way briefing; tool feedback allows repair', async () => {
  let rounds = 0;
  const agent = createRouteAgent(undefined, { places, directions: { route: async () => road }, generate: async contents => {
    rounds++;
    if (rounds === 1) return call('read_material', { material_id: 'doc' });
    if (rounds === 2) return call('finish_attention', { ...plan, outcome: 'brief' });
    expect(JSON.stringify(contents)).toContain('outcome=ask');
    return call('finish_attention', plan);
  } });
  const result = await agent(input, new AbortController().signal);
  expect(result.plan.outcome).toBe('ask'); expect(result.trace.rounds).toBe(3);
});
