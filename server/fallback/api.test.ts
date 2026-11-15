import { expect, test } from 'bun:test';
import { createFallbackApi } from './api';
const req = (path: string, body: unknown = {}, headers: Record<string, string> = {}) => new Request('http://127.0.0.1:5173/api/fallback/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
test('keyless status is explicit and token is unavailable rather than simulated', async () => {
  const app = createFallbackApi({});
  const status = await app(new Request('http://127.0.0.1:5173/api/fallback/status'));
  expect((await status.json()).liveConfigured).toBe(false);
  expect((await app(req('token'))).status).toBe(503);
});
test('foreign hosts and cross-site requests cannot use local credentials', async () => {
  const app = createFallbackApi({ GEMINI_API_KEY: 'not-a-real-key' });
  expect((await app(req('token', {}, { Origin: 'https://evil.example' }))).status).toBe(403);
  expect((await app(req('token', {}, { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403);
  expect((await app(new Request('http://evil.example/api/fallback/token', { method: 'POST', body: '{}' }))).status).toBe(403);
});
test('oversized/invalid input is rejected before provider calls', async () => {
  const app = createFallbackApi({ GEMINI_API_KEY: 'not-a-real-key' });
  expect((await app(req('token', { bad: true }))).status).toBe(400);
  expect((await app(req('places', { query: 'x'.repeat(49000) }))).status).toBe(413);
  expect((await app(req('places', { query: 'cafe', center: { latitude: 999, longitude: 0 } }))).status).toBe(400);
});
test('place search uses fixed official endpoint and private authorization', async () => {
  let called = '';
  const app = createFallbackApi({ KAKAO_DIRECTIONS_REST_API_KEY: 'test-server-only-key' }, async (url, init) => {
    called = String(url); expect(new Headers(init?.headers).get('Authorization')).toBe('KakaoAK test-server-only-key');
    return Response.json({ documents: [{ id: '123', place_name: '검사 카페', x: '127.01', y: '37.45', place_url: 'https://place.map.kakao.com/123' }] });
  });
  const response = await app(req('places', { query: '카페', center: { latitude: 37.4, longitude: 127 } }));
  const data = await response.json();
  expect(called.startsWith('https://dapi.kakao.com/v2/local/search/keyword.json?')).toBe(true);
  expect(data.places[0].id).toBe('kakao:123');
  expect(JSON.stringify(data)).not.toContain('test-server-only-key');
});

test('specific names can be searched beyond the nearby radius without changing nearby defaults', async () => {
  const urls: URL[] = [];
  const app = createFallbackApi({ KAKAO_DIRECTIONS_REST_API_KEY: 'test-key' }, async input => { urls.push(new URL(String(input))); return Response.json({ documents: [] }); });
  const center = { latitude: 37.4, longitude: 127 };
  expect((await app(req('places', { query: '용산역', center, scope: 'name' }))).status).toBe(200);
  expect(urls[0].searchParams.has('radius')).toBe(false); expect(urls[0].searchParams.get('sort')).toBe('accuracy');
  await app(req('places', { query: '카페', center }));
  expect(urls[1].searchParams.get('radius')).toBe('5000'); expect(urls[1].searchParams.get('sort')).toBe('distance');
});
