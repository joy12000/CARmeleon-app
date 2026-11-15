import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.env.CARMELEON_TEST_BASE_URL;
if (!base || process.env.CARMELEON_TEST_ISOLATED_STORE !== 'true') {
  throw new Error('Set CARMELEON_TEST_BASE_URL and CARMELEON_TEST_ISOLATED_STORE=true for the isolated test server.');
}
const original = resolve('server/data/store.json');
const hash = () => createHash('sha256').update(readFileSync(original)).digest('hex');
const before = hash();
async function request(path: string, method = 'GET', body?: unknown) {
  const result = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: result.status, data: await result.json() as any };
}
const routeId = 'kotlin-roundtrip';
const saved = await request('/api/v1/routes', 'POST', { routeId, title: 'Kotlin 전환 검증', stops: [{ id: 'hwaseong', name: '수원화성', latitude: 37.2886, longitude: 127.0128, type: 'travel' }] });
const active = await request('/api/v1/vehicles/me/active-route');
const briefings = await request(`/api/v1/routes/${routeId}/briefings`);
const session = await request('/api/v1/nav-sessions', 'POST', { sessionId: 'kotlin-session', routeId });
const unknownSession = await request('/api/v1/nav-sessions/no-such-session', 'PATCH', { status: 'NAV_CONFIRMED' });
const guide = await request('/api/v1/guide/autonomous', 'POST', { latitude: 37.28, longitude: 127.01, step: 0 });
const charger = await request('/api/v1/poi/nearby', 'POST', { type: 'ev_charger', latitude: 37.28, longitude: 127.01 });
const restroom = await request('/api/v1/poi/nearby', 'POST', { type: 'restroom', latitude: 37.28, longitude: 127.01 });
const checks = {
  save: saved.status === 200 && saved.data.route.routeId === routeId,
  active: active.data.activeRoute.routeId === routeId,
  briefings: briefings.status === 200 && briefings.data.briefings?.length === 1,
  stableSessionId: session.data.session.sessionId === 'kotlin-session',
  unknownSessionRejected: unknownSession.status === 404,
  guide: guide.status === 200 && Boolean(guide.data.speechText || guide.data.spot?.speechText),
  charger: charger.status === 200 && charger.data.items?.length > 0,
  restroom: restroom.status === 200 && restroom.data.items?.length > 0,
  originalStoreUnchanged: before === hash(),
};
mkdirSync('verification', { recursive: true });
writeFileSync('verification/backend-check.json', JSON.stringify({ checks, passed: Object.values(checks).every(Boolean), originalSha256: before, source: 'isolated Bun mock backend' }, null, 2));
console.log(JSON.stringify(checks, null, 2));
if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
