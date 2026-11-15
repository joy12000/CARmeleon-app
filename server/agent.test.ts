import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runner, Usage, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { createAgentApp } from './agent/http';
import { readConfig } from './agent/config';
import { DurableSession } from './agent/session';
import { id, now } from './agent/models';
import { AgentService } from './agent/agent';
import { KakaoLocalPlaces, type HttpFetcher } from './agent/places';

// Fixtures are deterministic transport/domain tests. They do not claim a real LLM or Pleos pass.
let directory: string;
let app: Awaited<ReturnType<typeof createAgentApp>>;
let tokenA: string;
let tokenB: string;
let accountA: string;
const stops = [
  { id: 'origin', name: '출발', coordinate: { latitude: 37.5, longitude: 126.95 }, materialIds: [], memoryIds: [] },
  { id: 'visit', name: '방문', coordinate: { latitude: 37.52, longitude: 126.93 }, materialIds: [], memoryIds: [] },
  { id: 'destination', name: '도착', coordinate: { latitude: 37.53, longitude: 126.96 }, materialIds: [], memoryIds: [] },
];
const op = () => crypto.randomUUID();
async function request(method: string, path: string, data?: unknown, token = tokenA) {
  return app.handler(new Request(`http://localhost/api/v1${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) }), 'fixture');
}
async function createPath() { const response = await request('POST', '/paths', { title: '테스트 이동', mode: 'TRAVEL', stops }); expect(response.status).toBe(201); return response.json() as Promise<any>; }
async function readyMaterial(materialId: string) {
  for (let i = 0; i < 200; i++) { const m = await app.materials.metadata(accountA, materialId); if (m.state !== 'PROCESSING') return m; await Bun.sleep(10); }
  throw new Error('Fixture extraction did not settle');
}
function pdfFixture(text: string) {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${i+1} 0 obj\n${object}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${o.toString().padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'carmeleon-agent-test-'));
  app = await createAgentApp(readConfig({ CARMELEON_AGENT_DATA_DIR: directory }));
  const first = await request('POST', '/auth/register', { email: 'a@example.test', password: 'fixture-password-123' }, '');
  const a = await first.json() as any;
  expect(first.status).toBe(201);
  tokenA = a.accessToken; accountA = a.account.id;
  const second = await request('POST', '/auth/register', { email: 'b@example.test', password: 'fixture-password-456' }, '');
  tokenB = (await second.json() as any).accessToken;
});
afterAll(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

describe('private account and revision contract', () => {
  test('requires a real session and isolates another account', async () => {
    const path = await createPath();
    expect((await request('GET', `/paths/${path.id}`, undefined, '')).status).toBe(401);
    expect((await request('GET', `/paths/${path.id}`, undefined, tokenB)).status).toBe(404);
    const login = await request('POST', '/auth/login', { email: 'a@example.test', password: 'fixture-password-123', deviceName: 'second device' }, '');
    const secondDevice = await login.json() as any;
    expect(login.status).toBe(200);
    expect((await request('GET', `/paths/${path.id}`, undefined, secondDevice.accessToken)).status).toBe(200);
  });
  test('rejects mock password login and weak registration', async () => {
    expect((await request('POST', '/auth/login', { email: 'a@example.test', password: 'incorrect-password' }, '')).status).toBe(401);
    expect((await request('POST', '/auth/register', { email: 'weak@example.test', password: '1234' }, '')).status).toBe(400);
  });
  test('a manual edit invalidates old proposals, and retries do not duplicate the edit', async () => {
    const path = await createPath();
    const proposal = await (await request('POST', `/paths/${path.id}/proposals`, { baseRevision: 1, stops: [...stops].reverse(), reason: '순서 변경', operationId: op() })).json() as any;
    const operationId = op();
    const edit = { baseRevision: 1, title: '수정된 일정', mode: 'TRAVEL', stops, operationId };
    const saved = await request('PUT', `/paths/${path.id}`, edit);
    const first = await saved.json() as any;
    const retry = await (await request('PUT', `/paths/${path.id}`, edit)).json() as any;
    expect(first.revision).toBe(2); expect(retry.revision).toBe(2);
    expect((await request('POST', `/decisions/${proposal.id}`, { accepted: true, baseRevision: 1, source: 'VOICE', operationId: op() })).status).toBe(409);
    expect((await request('PUT', `/paths/${path.id}`, { ...edit, title: 'different', operationId })).status).toBe(409);
    expect((await app.domain.actions(accountA, path.id)).length).toBe(0);
  });
  test('concurrent same-revision writes have exactly one winner', async () => {
    const path = await createPath();
    const responses = await Promise.all(['one', 'two'].map(title => request('PUT', `/paths/${path.id}`, { baseRevision: 1, title, mode: 'TRAVEL', stops, operationId: op() })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  });
  test('voice approval commits once but never claims SDK guidance', async () => {
    const path = await createPath();
    const proposal = await (await request('POST', `/paths/${path.id}/proposals`, { baseRevision: 1, stops: [...stops].reverse(), reason: '확인할 변경', operationId: op() })).json() as any;
    const operationId = op();
    const input = { accepted: true, baseRevision: 1, operationId, source: 'VOICE' };
    const response = await request('POST', `/decisions/${proposal.id}`, input);
    const result = await response.json() as any;
    expect(response.status).toBe(200); expect(result.action.status).toBe('REQUESTED'); expect(result.path.revision).toBe(2);
    expect((await (await request('POST', `/decisions/${proposal.id}`, input)).json() as any).action.id).toBe(result.action.id);
    expect((await request('POST', `/decisions/${proposal.id}`, { ...input, operationId: op() })).status).toBe(409);
    expect((await app.domain.actions(accountA, path.id)).length).toBe(1);
    expect((await request('POST', `/actions/${result.action.id}/report`, { status: 'GUIDING' })).status).toBe(400);
  });
  test('rejection leaves the canonical path and navigation untouched', async () => {
    const path = await createPath();
    const proposal = await app.domain.propose(accountA, path.id, { baseRevision: 1, stops: [...stops].reverse(), reason: '거절', operationId: op() });
    await app.domain.decide(accountA, proposal.id, { accepted: false, baseRevision: 1, source: 'BUTTON', operationId: op() });
    expect((await app.domain.path(accountA, path.id)).revision).toBe(1);
    expect((await app.domain.actions(accountA, path.id)).length).toBe(0);
  });
  test('one destination is valid and appointment time zones are checked on saves and proposals', async () => {
    const destination = { ...stops[0], memo: '주차는 지하', address: '시험용 주소', poiId: 'verified-place' };
    const response = await request('POST', '/paths', { title: '한 목적지', mode: 'BUSINESS', stops: [destination] });
    const path = await response.json() as any;
    expect(response.status).toBe(201); expect(path.stops[0].memo).toBe('주차는 지하'); expect(path.stops[0].poiId).toBe('verified-place');
    const invalid = [{ ...destination, appointmentAt: '2026-12-01T10:00:00+09:00', timeZone: 'Not/AZone' }];
    expect((await request('PUT', `/paths/${path.id}`, { baseRevision: 1, title: path.title, mode: path.mode, stops: invalid, operationId: op() })).status).toBe(400);
    expect((await request('POST', `/paths/${path.id}/proposals`, { baseRevision: 1, stops: invalid, reason: '잘못된 시간대', operationId: op() })).status).toBe(400);
  });
  test('preview evidence cannot be promoted to actual guidance', async () => {
    const path = await createPath();
    const simulation = { routeId: 'sim', fingerprint: 'sim-fp', status: 'SIMULATION', observedAt: now(), source: 'PREVIEW' };
    expect((await request('PUT', `/paths/${path.id}/guidance`, { ...simulation, status: 'GUIDING' })).status).toBe(400);
    const proposal = await app.domain.propose(accountA, path.id, { baseRevision: 1, stops, reason: '시뮬레이션', operationId: op() });
    const approved = await app.domain.decide(accountA, proposal.id, { accepted: true, baseRevision: 1, source: 'BUTTON', operationId: op() });
    expect((await request('POST', `/actions/${approved.action!.id}/report`, { status: 'GUIDING', guidance: simulation })).status).toBe(400);
    expect((await request('POST', `/actions/${approved.action!.id}/report`, { status: 'SIMULATION', guidance: simulation })).status).toBe(200);
    expect((await app.domain.actions(accountA, path.id))[0].status).toBe('SIMULATION');
  });
});

describe('memory and original material', () => {
  test('memory edits/deletion/history/restore persist with account scoping', async () => {
    const path = await createPath();
    const created = await (await request('POST', '/memory', { text: '납기를 우선', pathId: path.id, kind: 'USER_FACT', operationId: op() })).json() as any;
    expect((await request('PUT', `/memory/${created.id}`, { text: '침범', baseRevision: 1, operationId: op() }, tokenB)).status).toBe(404);
    await request('PUT', `/memory/${created.id}`, { text: '납기와 주차', baseRevision: 1, operationId: op() });
    await request('DELETE', `/memory/${created.id}`, { baseRevision: 2, operationId: op() });
    expect((await app.domain.memories(accountA, path.id, undefined, '납기')).length).toBe(0);
    const history = await app.domain.memoryHistory(accountA, created.id);
    expect(history.length).toBe(3);
    const restored = await app.domain.restoreMemory(accountA, created.id, { revision: 1, baseRevision: 3, operationId: op() });
    expect(restored.text).toBe('납기를 우선'); expect(restored.revision).toBe(4); expect(restored.deleted).toBe(false);
  });
  test('private original, read excerpts, and confirmed deletion are distinct', async () => {
    const path = await createPath();
    const form = new FormData(); form.set('pathId', path.id); form.set('file', new File(['납기는 12월 1일.\f가격은 별도 협의.'], '계약서.txt', { type: 'text/plain' }));
    const upload = await app.handler(new Request('http://localhost/api/v1/materials', { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` }, body: form }));
    const m = await upload.json() as any;
    expect(upload.status).toBe(201); expect(m.state).toBe('PROCESSING'); expect(m.objectKey).toBeUndefined();
    const ready = await readyMaterial(m.id); expect(ready.state).toBe('READY');
    const excerpts = await app.materials.excerpts(accountA, m.id); expect(excerpts.length).toBe(2); expect(excerpts[1].page).toBe(2);
    expect((await request('GET', `/materials/${m.id}/content`, undefined, tokenB)).status).toBe(404);
    expect((await request('GET', `/materials/${m.id}/content`)).status).toBe(200);
    expect((await request('DELETE', `/materials/${m.id}`, { baseRevision: m.revision, operationId: op() })).status).toBe(400);
    expect((await request('DELETE', `/materials/${m.id}`, { baseRevision: m.revision, operationId: op(), confirmed: true })).status).toBe(200);
    expect((await request('GET', `/materials/${m.id}/content`)).status).toBe(404);
    expect((await app.materials.search(accountA, path.id, '납기')).length).toBe(0);
  });
  test('file name and image attachment do not count as extracted knowledge', async () => {
    const path = await createPath();
    const form = new FormData(); form.set('pathId', path.id); form.set('file', new File([new Uint8Array([0xff,0xd8,0xff,0xe0,0,0])], '중요한납기.jpg', { type: 'image/jpeg' }));
    const m = await app.materials.upload(accountA, form);
    expect((await readyMaterial(m.id)).state).toBe('UNSUPPORTED');
    expect((await app.materials.search(accountA, path.id, '납기')).length).toBe(0);
  });
  test('PDF runtime extracts real page text and preserves a page source', async () => {
    const path = await createPath();
    const form = new FormData(); form.set('pathId', path.id); form.set('file', new File([pdfFixture('Delivery deadline: December 1.')], 'briefing.pdf', { type: 'application/pdf' }));
    const material = await app.materials.upload(accountA, form);
    const result = await readyMaterial(material.id);
    expect(result.state).toBe('READY');
    const found = await app.materials.search(accountA, path.id, 'Delivery');
    expect(found.length).toBe(1); expect(found[0].source.page).toBe(1); expect(found[0].source.version).toBe(1); expect(found[0].text).toContain('December 1.');
  }, 15000);
});

describe('proactive preparation and honest missing capabilities', () => {
  test('no configured model returns 503 without canned speech', async () => {
    const path = await createPath();
    const response = await request('POST', '/turns', { turnId: id('turn'), sessionId: id('session'), pathId: path.id, text: '안녕' });
    expect(response.status).toBe(503); expect((await response.json() as any).error.code).toBe('MODEL_NOT_CONFIGURED');
  });
  test('preparation requires fresh matching observed guidance and sourced text', async () => {
    const path = await createPath();
    const input = { pathId: path.id, baseRevision: 1, routeId: 'route1', guidanceFingerprint: 'fp1', segmentId: 'origin:visit', points: [{ id: 'point', name: '확인된 장소', coordinate: stops[1].coordinate, etaSeconds: 100, sources: [{ url: 'https://example.test/place', text: '시험용 출처 문장.' }] }] };
    expect((await request('POST', '/narratives/prepare', input)).status).toBe(409);
    await app.domain.guidance(accountA, path.id, { routeId: 'route1', fingerprint: 'fp1', status: 'SIMULATION', observedAt: now(), source: 'PREVIEW' });
    expect((await request('POST', '/narratives/prepare', { ...input, points: [{ ...input.points[0], sources: [{ url: 'https://example.test/place' }] }] })).status).toBe(400);
    const beyond = await request('POST', '/narratives/prepare', { ...input, points: [{ ...input.points[0], etaSeconds: 900 }] });
    expect(beyond.status).toBe(200); expect((await beyond.json() as any).utterances.length).toBe(0);
    expect((await request('POST', '/narratives/prepare', input)).status).toBe(503);
    expect((await app.domain.path(accountA, path.id)).stops).toEqual(stops);
  });
  test('manual changes preserve only explicitly unchanged prepared segments', async () => {
    const path = await createPath();
    const fixture = (planId: string, segmentId: string) => ({ id: planId, pathId: path.id, pathRevision: 1, segmentId, routeId: 'r', guidanceFingerprint: 'f', pointIds: ['p'], cacheKey: planId, coverage: 'LIMITED', status: 'READY', createdAt: now(), expiresAt: new Date(Date.now()+60000).toISOString(), sourceVersions: [] });
    await app.store.write(accountA, async r => { await r.put('narrative', 'keep', fixture('keep', 'origin:visit')); await r.put('narrative', 'drop', fixture('drop', 'visit:destination')); });
    const changed = stops.map(s => s.id === 'destination' ? { ...s, name: '다른 도착' } : s);
    await app.domain.savePath(accountA, path.id, { baseRevision: 1, title: path.title, mode: path.mode, stops: changed, operationId: op() });
    const data = await app.narratives.list(accountA, path.id);
    expect(data.plans.find(p => p.id === 'keep')?.status).toBe('READY'); expect(data.plans.find(p => p.id === 'keep')?.pathRevision).toBe(2);
    expect(data.plans.find(p => p.id === 'drop')?.status).toBe('INVALIDATED');
  });
});

class FixtureModel implements Model {
  calls = 0;
  constructor(private output: string, private wait = false) {}
  async getResponse(_request: ModelRequest): Promise<ModelResponse> { return { usage: new Usage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: this.output }] }] }; }
  async *getStreamedResponse(request: ModelRequest): AsyncGenerator<any> {
    this.calls++;
    yield { type: 'response_started' };
    yield { type: 'output_text_delta', delta: this.output.slice(0, 8) };
    if (this.wait) {
      await new Promise<void>((_resolve, reject) => { if (request.signal?.aborted) reject(new Error('aborted')); else request.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
    }
    yield { type: 'output_text_delta', delta: this.output.slice(8) };
    yield { type: 'response_done', response: { id: 'fixture_response', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, output: (await this.getResponse(request)).output } };
  }
}
class ApprovalFixtureModel extends FixtureModel {
  step = 0;
  constructor(private proposalId: () => Promise<string>) { super('변경 적용을 요청했어요.'); }
  async *getStreamedResponse(request: ModelRequest): AsyncGenerator<any> {
    if (this.step >= 2) { yield* super.getStreamedResponse(request); return; }
    const stage = this.step++;
    const args = stage === 0 ? { baseRevision: 1, stops: stops.map(s => ({ id: s.id, name: s.name, latitude: s.coordinate.latitude, longitude: s.coordinate.longitude, purpose: null, appointmentAt: null, timeZone: null, dwellMinutes: null })), reason: 'SDK 승인 시험' } : { proposalId: await this.proposalId() };
    yield { type: 'response_done', response: { id: `approval_fixture_${stage}`, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, output: [{ type: 'function_call', callId: `approval_call_${stage}`, name: stage === 0 ? 'path_propose_changes' : 'request_path_application', arguments: JSON.stringify(args) }] } };
  }
}
const placeDocument = { id: '12345', place_name: 'Fixture Cafe', x: '126.951', y: '37.501', place_url: 'http://place.map.kakao.com/12345', road_address_name: 'Fixture road', category_name: '음식점 > 카페', distance: '140' };
class ScriptFixtureModel extends FixtureModel {
  private step = 0;
  requests: ModelRequest[] = [];
  constructor(private steps: { name: string; arguments: unknown }[]) { super('확인한 후보로 볼까요?'); }
  async *getStreamedResponse(request: ModelRequest): AsyncGenerator<any> {
    this.requests.push(request);
    const step = this.steps[this.step++];
    if (!step) { yield* super.getStreamedResponse(request); return; }
    yield { type: 'response_done', response: { id: `script_fixture_${this.step}`, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, output: [{ type: 'function_call', callId: `script_call_${this.step}`, name: step.name, arguments: JSON.stringify(typeof step.arguments === 'function' ? await step.arguments() : step.arguments) }] } };
  }
}
function proposalArguments(extra?: { id: string; name: string; latitude: number; longitude: number }) {
  const existing = stops.map(s => ({ id: s.id, name: s.name, latitude: s.coordinate.latitude, longitude: s.coordinate.longitude, purpose: null, appointmentAt: null, timeZone: null, dwellMinutes: null }));
  return { baseRevision: 1, reason: '실제 검색 후보 시험', stops: extra ? [existing[0], { ...extra, purpose: null, appointmentAt: null, timeZone: null, dwellMinutes: null }, ...existing.slice(1)] : existing };
}
describe('Kakao Local adapter and AI place provenance', () => {
  test('missing Kakao key returns UNSUPPORTED without a network request', async () => {
    let calls = 0;
    const provider = new KakaoLocalPlaces({}, async () => { calls++; throw new Error('must not call'); });
    const result = await provider.search('카페', stops[0].coordinate);
    expect(result.status).toBe('UNSUPPORTED'); expect(result.places).toEqual([]); expect(calls).toBe(0); expect(result.fetchedAt).toBeUndefined();
  });
  test('official request parameters and provider coordinates/source are mapped without road ETA', async () => {
    let requested: URL | undefined, authorization: string | null = null;
    const provider = new KakaoLocalPlaces({ kakaoLocalRestApiKey: 'fixture-key' }, async (input, init) => {
      requested = new URL(input.toString()); authorization = new Headers(init?.headers).get('Authorization');
      return Response.json({ documents: [placeDocument, { ...placeDocument, id: '999', x: '999' }] });
    });
    const result = await provider.search(' 서울 카페 ', stops[0].coordinate);
    expect(requested?.origin).toBe('https://dapi.kakao.com'); expect(requested?.pathname).toBe('/v2/local/search/keyword.json');
    expect(requested?.searchParams.get('query')).toBe('서울 카페'); expect(requested?.searchParams.get('x')).toBe('126.95'); expect(requested?.searchParams.get('y')).toBe('37.5'); expect(requested?.searchParams.get('radius')).toBe('5000'); expect(requested?.searchParams.get('sort')).toBe('distance'); expect(authorization as string | null).toBe('KakaoAK fixture-key');
    expect(result.status).toBe('READY'); expect(result.places.length).toBe(1); expect(result.places[0].coordinate).toEqual({ latitude: 37.501, longitude: 126.951 });
    expect(result.places[0].source.url).toBe('https://place.map.kakao.com/12345'); expect(result.fetchedAt).toBe(result.places[0].source.fetchedAt); expect(result.distanceKind).toBe('CENTER_DISTANCE'); expect(JSON.stringify(result)).not.toContain('fixture-key'); expect('etaSeconds' in result.places[0]).toBe(false);
  });
  test('provider rejection, malformed coordinates and cancellation never become made-up results', async () => {
    const config = { kakaoLocalRestApiKey: 'secret-fixture' };
    await expect(new KakaoLocalPlaces(config, async () => Response.json({ error: 'secret-fixture' }, { status: 401 })).search('카페', stops[0].coordinate)).rejects.toMatchObject({ code: 'PLACES_PROVIDER_REJECTED' });
    await expect(new KakaoLocalPlaces(config, async () => Response.json({ documents: [{ ...placeDocument, x: 'not a number' }] })).search('카페', stops[0].coordinate)).rejects.toMatchObject({ code: 'PLACES_INVALID_RESPONSE' });
    const abort = new AbortController(); abort.abort();
    const cancelledFetch: HttpFetcher = async (_url, init) => { init?.signal?.throwIfAborted(); throw new Error('not reached'); };
    await expect(new KakaoLocalPlaces(config, cancelledFetch).search('카페', stops[0].coordinate, abort.signal)).rejects.toMatchObject({ code: 'PLACES_CANCELLED' });
  });
  test('actual SDK can propose only the current-turn verified result and preserves canonical place identity', async () => {
    const path = await createPath();
    let calls = 0;
    const provider = new KakaoLocalPlaces({ kakaoLocalRestApiKey: 'fixture-key' }, async () => { calls++; return Response.json({ documents: [placeDocument] }); });
    const service = new AgentService(app.domain, app.materials, { ...app.agent.config, apiKey: 'fixture', model: 'fixture' }, provider);
    const model = new ScriptFixtureModel([{ name: 'places_search', arguments: { query: '카페' } }, { name: 'path_propose_changes', arguments: proposalArguments({ id: 'kakao:12345', name: 'LLM must not rename this venue', latitude: 37.501, longitude: 126.951 }) }, { name: 'request_path_application', arguments: async () => ({ proposalId: (await app.domain.proposals(accountA, path.id))[0].id }) }]);
    service.runner = () => new Runner({ modelProvider: { getModel: async () => model }, tracingDisabled: true, traceIncludeSensitiveData: false });
    const input = await service.begin(accountA, { turnId: id('turn'), sessionId: id('session'), pathId: path.id, text: '근처 카페를 들러볼까', location: stops[0].coordinate });
    const events: string[] = []; await service.execute(accountA, input, async e => { events.push(e.event); });
    const proposals = await app.domain.proposals(accountA, path.id);
    expect(calls).toBe(1); expect(proposals.length).toBe(1); expect(proposals[0].stops[1].name).toBe('Fixture Cafe'); expect(proposals[0].stops[1].poiId).toBe('kakao:12345'); expect(events).toContain('decision.required'); expect((await app.domain.path(accountA, path.id)).revision).toBe(1);
  });
  test('AI cannot reuse another turn search or alter existing coordinates; manual REST input remains allowed', async () => {
    const path = await createPath();
    const provider = new KakaoLocalPlaces({ kakaoLocalRestApiKey: 'fixture-key' }, async () => Response.json({ documents: [placeDocument] }));
    const service = new AgentService(app.domain, app.materials, { ...app.agent.config, apiKey: 'fixture', model: 'fixture' }, provider);
    const earlier = { turnId: id('turn'), sessionId: id('session'), pathId: path.id, text: '이전 검색' };
    await service.searchPlaces(accountA, earlier, '카페');
    const altered = proposalArguments({ id: 'kakao:12345', name: '이전 검색 결과', latitude: 37.501, longitude: 126.951 });
    const model = new ScriptFixtureModel([{ name: 'path_propose_changes', arguments: altered }, { name: 'path_propose_changes', arguments: { ...proposalArguments(), stops: [{ ...proposalArguments().stops[0], latitude: 38 }, ...proposalArguments().stops.slice(1)] } }]);
    service.runner = () => new Runner({ modelProvider: { getModel: async () => model }, tracingDisabled: true, traceIncludeSensitiveData: false });
    const input = await service.begin(accountA, { turnId: id('turn'), sessionId: id('session'), pathId: path.id, text: '임의 좌표 시험' });
    await service.execute(accountA, input, async () => {});
    expect((await app.domain.proposals(accountA, path.id)).length).toBe(0);
    expect(JSON.stringify(model.requests)).toContain('이번 검색에서 확인한 장소');
    const manual = await request('POST', `/paths/${path.id}/proposals`, { baseRevision: 1, stops: [{ ...stops[0], coordinate: { latitude: 38, longitude: 127 } }], reason: '사용자가 직접 확인한 좌표', operationId: op() });
    expect(manual.status).toBe(201);
  });
});
describe('actual SDK with deterministic model fixtures', () => {
  test('a deictic reference can only name a recently spoken point in the same private path', async () => {
    const path = await createPath();
    const originalModel = app.agent.config.model, originalKey = app.agent.config.apiKey;
    app.agent.config.model = 'fixture'; app.agent.config.apiKey = 'fixture';
    const pointId = id('point');
    const turn = () => ({ turnId: id('turn'), sessionId: id('session'), pathId: path.id, text: '거기 들를까', referencedPointId: pointId });
    try {
      await expect(app.agent.begin(accountA, turn())).rejects.toThrow('최근 이야기한');
      const utterance = { id: id('utterance'), pathId: path.id, pathRevision: 1, planId: 'fixture-plan', pointId, text: '근처 장소 이야기', coordinate: stops[0].coordinate, sources: [{ url: 'https://example.test/place', text: '시험 근거' }], routeId: 'fixture-route', guidanceFingerprint: 'fixture-fp', expiresAt: new Date(Date.now()+60000).toISOString(), status: 'PREPARED', createdAt: now() };
      await app.store.write(accountA, r => r.put('utterance', utterance.id, utterance));
      await expect(app.agent.begin(accountA, turn())).rejects.toThrow('최근 이야기한');
      await app.store.write(accountA, r => r.put('utterance', utterance.id, { ...utterance, status: 'COMPLETED' }));
      const accepted = await app.agent.begin(accountA, turn()); expect(accepted.referencedPointId).toBe(pointId);
      await app.agent.cancel(accountA, accepted.turnId);
    } finally { app.agent.config.model = originalModel; app.agent.config.apiKey = originalKey; }
  });
  test('SDK text deltas become sentence chunks; generated text is not delivered history without ACK', async () => {
    const path = await createPath();
    const fixture = new FixtureModel('먼저 짧게 말해요. 다음 문장도 짧아요.');
    const originalRunner = app.agent.runner;
    const originalModel = app.agent.config.model, originalKey = app.agent.config.apiKey;
    app.agent.config.model = 'fixture'; app.agent.config.apiKey = 'fixture';
    app.agent.runner = () => new Runner({ modelProvider: { getModel: async () => fixture }, tracingDisabled: true, traceIncludeSensitiveData: false });
    const turnId = id('turn'), sessionId = id('session');
    try {
      const response = await request('POST', '/turns', { turnId, sessionId, pathId: path.id, text: '짧게 말해' });
      const stream = await response.text();
      expect(response.status).toBe(200); expect(stream).toContain('event: assistant.speech_chunk'); expect(stream).toContain('event: turn.completed'); expect(fixture.calls).toBe(1);
      const session = new DurableSession(app.store, accountA, sessionId, path.id, 'inspection');
      expect((await session.getItems()).filter(i => 'role' in i && i.role === 'assistant').length).toBe(0);
      await request('POST', '/playback', { turnId, status: 'COMPLETED' });
      expect(JSON.stringify(await session.getItems())).toContain('먼저 짧게 말해요.');
      expect((await request('POST', '/turns', { turnId, sessionId, pathId: path.id, text: '다시' })).status).toBe(409);
    } finally { app.agent.runner = originalRunner; app.agent.config.model = originalModel; app.agent.config.apiKey = originalKey; }
  });
  test('turn cancellation aborts SDK generation but preserves accepted domain operations', async () => {
    const path = await createPath();
    const fixture = new FixtureModel('기다리는 응답입니다.', true);
    const originalRunner = app.agent.runner;
    const originalModel = app.agent.config.model, originalKey = app.agent.config.apiKey;
    app.agent.config.model = 'fixture'; app.agent.config.apiKey = 'fixture';
    app.agent.runner = () => new Runner({ modelProvider: { getModel: async () => fixture }, tracingDisabled: true, traceIncludeSensitiveData: false });
    const turnId = id('turn'), sessionId = id('session');
    try {
      const input = await app.agent.begin(accountA, { turnId, sessionId, pathId: path.id, text: '대기' });
      const events: string[] = [];
      const running = app.agent.execute(accountA, input, async event => { events.push(event.event); });
      for (let n = 0; n < 100 && !fixture.calls; n++) await Bun.sleep(10);
      const note = await app.domain.createMemory(accountA, { text: '취소와 별개로 남을 기억', pathId: path.id, operationId: op() });
      await app.agent.cancel(accountA, turnId);
      await running;
      expect((await app.agent.record(accountA, turnId)).status).toBe('CANCELLED');
      expect(events).toContain('turn.cancelled'); expect(events).not.toContain('turn.completed');
      expect((await app.domain.memories(accountA, path.id)).some(n => n.id === note.id)).toBe(true);
    } finally { app.agent.runner = originalRunner; app.agent.config.model = originalModel; app.agent.config.apiKey = originalKey; }
  });
  test('SDK approval snapshot resumes only after the matching domain decision, without dispatching twice', async () => {
    const path = await createPath();
    const fixture = new ApprovalFixtureModel(async () => (await app.domain.proposals(accountA, path.id))[0].id);
    const originalRunner = app.agent.runner;
    const originalModel = app.agent.config.model, originalKey = app.agent.config.apiKey;
    app.agent.config.model = 'fixture'; app.agent.config.apiKey = 'fixture';
    app.agent.runner = () => new Runner({ modelProvider: { getModel: async () => fixture }, tracingDisabled: true, traceIncludeSensitiveData: false });
    const turnId = id('turn'), sessionId = id('session');
    try {
      const response = await request('POST', '/turns', { turnId, sessionId, pathId: path.id, text: '경로를 이렇게 바꿔볼까' });
      const first = await response.text();
      expect(first).toContain('WAITING_APPROVAL');
      const proposal = (await app.domain.proposals(accountA, path.id))[0];
      expect((await app.domain.actions(accountA, path.id)).length).toBe(0);
      await app.domain.decide(accountA, proposal.id, { accepted: true, baseRevision: 1, source: 'VOICE', operationId: op() });
      const resumed = await request('POST', '/turns', { turnId: id('turn'), sessionId, pathId: path.id, text: '응', resumeDecisionId: proposal.id });
      expect(await resumed.text()).toContain('event: turn.completed');
      expect((await app.domain.actions(accountA, path.id)).length).toBe(1);
      expect((await app.domain.actions(accountA, path.id))[0].status).toBe('REQUESTED');
      expect((await app.domain.path(accountA, path.id)).revision).toBe(2);
    } finally { app.agent.runner = originalRunner; app.agent.config.model = originalModel; app.agent.config.apiKey = originalKey; }
  });
});
