import { GoogleGenAI, Modality } from '@google/genai';
import { z } from 'zod';
import { KakaoLocalPlaces } from '../agent/places';
import { liveFunctions, liveInstruction, LIVE_MODEL } from '../../src/live/protocol';
import { createSpeechPreparer, PrepareInput } from './prepare';
import { AgentInvestigationError, createRouteAgent } from './agent';
import { KakaoDirections } from '../maps/directions';

export type FallbackEnv = Record<string, string | undefined>;
export function createFallbackApi(env: FallbackEnv, http: typeof fetch = fetch) {
  const key = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  const model = env.CARMELEON_GEMINI_LIVE_MODEL?.trim() || LIVE_MODEL;
  const places = new KakaoLocalPlaces({ kakaoLocalRestApiKey: env.KAKAO_LOCAL_REST_API_KEY || env.KAKAO_DIRECTIONS_REST_API_KEY }, http);
  const prepare = createSpeechPreparer(key, env.CARMELEON_GEMINI_PREPARE_MODEL || 'gemini-3.8-flash');
  const agent = createRouteAgent(key, { places, directions: new KakaoDirections(env.KAKAO_DIRECTIONS_REST_API_KEY, http) }, env.CARMELEON_GEMINI_PREPARE_MODEL || 'gemini-3.8-flash');
  const limits = new Map<string, number[]>();
  let activeTokens = 0;
  function limit(kind: string, count: number) {
    const now = Date.now(), times = (limits.get(kind) || []).filter(t => t > now - 60_000);
    if (times.length >= count) throw new LocalError(429, '요청이 잠시 많아요. 1분 뒤 다시 시도해 주세요.');
    times.push(now); limits.set(kind, times);
  }
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
          (request.headers.get('origin') && request.headers.get('origin') !== url.origin) ||
          request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: '이 PC의 로컬 시연 화면에서만 사용할 수 있어요.' }, 403);
      const path = url.pathname;
      if (path === '/api/fallback/status' && request.method === 'GET')
        return json({ liveConfigured: !!key, model, placesConfigured: !!(env.KAKAO_LOCAL_REST_API_KEY || env.KAKAO_DIRECTIONS_REST_API_KEY), directionsConfigured: !!env.KAKAO_DIRECTIONS_REST_API_KEY });
      if (request.method !== 'POST') return json({ error: 'POST 요청이 필요해요.' }, 405);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON 요청이 필요해요.' }, 415);
      const text = await request.text();
      if (text.length > 48_000) return json({ error: '요청이 너무 커요.' }, 413);
      const input = JSON.parse(text);
      if (path === '/api/fallback/agent') {
        if (!key) return json({ error: 'Gemini 연결 후 동행 작업을 시작할 수 있어요.' }, 503);
        limit('agent', 4);
        try { return json(await agent(input, request.signal)); }
        catch (error) { return json({ error: error instanceof z.ZodError ? '현재 이동 맥락을 확인해 주세요.' : '지금은 다음 행동을 준비하지 못했어요. 대화는 계속할 수 있어요.', ...(error instanceof AgentInvestigationError ? { diagnostic: { code: error.code, trace: error.trace } } : {}) }, error instanceof z.ZodError ? 400 : 503); }
      }
      if (path === '/api/fallback/prepare') {
        if (!key) return json({ error: 'Gemini 설정 후 이야기를 준비할 수 있어요.' }, 503);
        limit('prepare', 30);
        try { return json(await prepare(PrepareInput.parse(input))); }
        catch (error) {
          if (error instanceof z.ZodError) return json({ error: '안내 자료를 확인해 주세요.' }, 400);
          return json({ error: '지금은 출처 있는 안내를 준비하지 못했어요. 대화는 계속할 수 있어요.' }, 503);
        }
      }
      if (path === '/api/fallback/token') {
        if (!key) return json({ error: '서버 .env에 GEMINI_API_KEY를 설정하고 개발 서버를 다시 시작해 주세요.' }, 503);
        limit('token', 6);
        if (activeTokens >= 2) return json({ error: '음성 연결을 준비하고 있어요. 잠시 뒤 다시 시도해 주세요.' }, 429);
        z.object({}).strict().parse(input);
        activeTokens++;
        try {
          const config = {
            responseModalities: [Modality.AUDIO],
            systemInstruction: liveInstruction,
            tools: [{ functionDeclarations: liveFunctions }],
            inputAudioTranscription: {}, outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
            sessionResumption: {}, contextWindowCompression: { slidingWindow: {} },
            maxOutputTokens: 1536,
          };
          const ai = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: 'v1beta', timeout: 15000 } });
          const token = await ai.authTokens.create({ config: {
            uses: 1, expireTime: new Date(Date.now() + 15 * 60_000).toISOString(),
            newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
            liveConnectConstraints: { model, config },
          } });
          if (!token.name) throw new Error('missing token');
          return json({ token: token.name, model, config, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
        } catch {
          return json({ error: 'Gemini Live 접속을 준비하지 못했어요. API 키·Live 모델 권한·할당량을 확인해 주세요.' }, 502);
        } finally { activeTokens--; }
      }
      if (path === '/api/fallback/places') {
        limit('places', 30);
        const search = z.object({ query: z.string().trim().min(1).max(120), center: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }), scope: z.enum(['nearby', 'name']).default('nearby') }).strict().parse(input);
        return json(await places.search(search.query, search.center, request.signal, search.scope));
      }
      return json({ error: '요청 주소를 찾을 수 없어요.' }, 404);
    } catch (error) {
      if (error instanceof LocalError) return json({ error: error.message }, error.status);
      if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: '입력 형식을 확인해 주세요.' }, 400);
      return json({ error: '요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, 502);
    }
  };
}
class LocalError extends Error { constructor(public status: number, message: string) { super(message); } }
