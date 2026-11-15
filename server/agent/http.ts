import { z } from 'zod';
import { AgentService } from './agent';
import { Auth } from './auth';
import { readConfig } from './config';
import type { Config } from './config';
import { Domain } from './domain';
import { Materials, publicMaterial } from './materials';
import { ApiError, now, requireValue } from './models';
import { Narratives } from './narratives';
import { Store } from './store';
import { KakaoLocalPlaces, type PlacesProvider } from './places';
import type { Playback, SpeechChunk } from './session';
import { synthesizeGeminiTts } from './tts';
import { DirectionsError, KakaoDirections } from '../maps/directions';

export async function createAgentApp(config: Config = readConfig(), dependencies: { places?: PlacesProvider } = {}) {
  const store = await Store.open(config);
  const auth = new Auth(store, config);
  const domain = new Domain(store);
  const materials = new Materials(domain, config);
  const places = dependencies.places ?? new KakaoLocalPlaces(config);
  const directions = new KakaoDirections(config.kakaoDirectionsRestApiKey);
  const agent = new AgentService(domain, materials, config, places);
  const narratives = new Narratives(domain, materials, agent);
  await agent.recover();
  await materials.recover();
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
  const handler = async (request: Request, clientAddress = 'local') => {
    let response: Response;
    try {
      const origin = request.headers.get('origin');
      if (origin && !config.allowedOrigins.includes(origin)) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', '허용되지 않은 웹 출처예요.');
      if (request.method === 'OPTIONS') {
        response = new Response(null, { status: 204, headers });
      } else {
        const url = new URL(request.url);
        const parts = url.pathname.split('/').filter(Boolean).map(p => decodeURIComponent(p));
        if (parts[0] !== 'api' || parts[1] !== 'v1') throw new ApiError(404, 'NOT_FOUND', 'API를 찾을 수 없어요.');
        const [resource, itemId, child] = parts.slice(2);
        const method = request.method;
        const body = () => readJson(request);
        if (resource === 'health' && method === 'GET') {
          response = json({ ok: true, version: 1, agentSdk: '0.21.0', modelConfigured: !!config.apiKey && !!config.model, placesConfigured: !!config.kakaoLocalRestApiKey, ttsConfigured: !!config.geminiApiKey, ttsProvider: config.geminiApiKey ? 'GEMINI' : 'BROWSER', storage: config.databaseUrl && config.s3 ? 'PRIVATE_CLOUD' : 'LOCAL_DEVELOPMENT', pleosRuntime: 'CLIENT_ONLY', registrationEnabled: config.allowRegistration });
        } else if (resource === 'simulator' && itemId === 'tts' && method === 'POST') {
          const input = z.object({ text: z.string().trim().min(1).max(800), preset: z.enum(['cute', 'bubbly', 'calm']).default('cute') }).parse(await body());
          if (!config.geminiApiKey) {
            response = json({ configured: false, reason: 'GEMINI_API_KEY가 아직 서버 .env에 설정되지 않았어요.' });
          } else {
            const synthesized = await synthesizeGeminiTts({ text: input.text, preset: input.preset, apiKey: config.geminiApiKey, model: config.geminiTtsModel });
            response = new Response(Buffer.from(synthesized.wav), { status: 200, headers: { ...headers, 'Content-Type': 'audio/wav', 'X-CARmeleon-TTS-Provider': 'GEMINI', 'X-CARmeleon-TTS-Voice': synthesized.voiceName } });
          }
        } else if (resource === 'simulator' && itemId === 'ask' && method === 'POST') {
          response = json(await agent.simulatorAsk(await body()));
        } else if (resource === 'simulator' && itemId === 'places' && method === 'POST') {
          const input = z.object({ query: z.string().trim().min(1).max(120), center: z.object({ latitude: z.number().finite(), longitude: z.number().finite() }).default({ latitude: 37.464, longitude: 127.042 }) }).parse(await body());
          const searchResult = await places.search(input.query, input.center);
          response = json({ configured: searchResult.status === 'READY', places: searchResult.places, reason: searchResult.reason });
        } else if (resource === 'auth' && ['register', 'login'].includes(itemId) && method === 'POST') {
          response = json(await auth.credentials(await body(), itemId === 'register', clientAddress), itemId === 'register' ? 201 : 200);
        } else {
          const context = await auth.authenticate(request);
          const accountId = context.account.id;
          if (resource === 'auth' && itemId === 'me' && method === 'GET') response = json({ account: context.account, deviceId: context.deviceId });
          else if (resource === 'auth' && itemId === 'logout' && method === 'POST') { await auth.logout(context); response = json({ ok: true }); }
          else if (resource === 'directions' && !itemId && method === 'POST') response = json(await directions.route(await body()));
          else if (resource === 'paths' && !itemId && method === 'GET') response = json({ paths: await domain.paths(accountId) });
          else if (resource === 'paths' && !itemId && method === 'POST') response = json(await domain.createPath(accountId, await body()), 201);
          else if (resource === 'paths' && itemId && !child && method === 'GET') response = json(await domain.path(accountId, itemId));
          else if (resource === 'paths' && itemId && !child && method === 'PUT') response = json(await domain.savePath(accountId, itemId, await body()));
          else if (resource === 'paths' && itemId && child === 'proposals' && method === 'GET') response = json({ proposals: await domain.proposals(accountId, itemId) });
          else if (resource === 'paths' && itemId && child === 'proposals' && method === 'POST') response = json(await domain.propose(accountId, itemId, await body()), 201);
          else if (resource === 'paths' && itemId && child === 'guidance' && method === 'GET') response = json(await domain.guidance(accountId, itemId));
          else if (resource === 'paths' && itemId && child === 'guidance' && method === 'PUT') response = json(await domain.guidance(accountId, itemId, await body()));
          else if (resource === 'decisions' && itemId && method === 'POST') response = json(await domain.decide(accountId, itemId, await body()));
          else if (resource === 'actions' && !itemId && method === 'GET') response = json({ actions: await domain.actions(accountId, url.searchParams.get('pathId') ?? undefined) });
          else if (resource === 'actions' && itemId && child === 'report' && method === 'POST') response = json(await domain.reportAction(accountId, itemId, await body()));
          else if (resource === 'memory' && !itemId && method === 'GET') response = json({ notes: await domain.memories(accountId, url.searchParams.get('pathId') ?? undefined, url.searchParams.get('stopId') ?? undefined, url.searchParams.get('q') ?? '') });
          else if (resource === 'memory' && !itemId && method === 'POST') response = json(await domain.createMemory(accountId, await body()), 201);
          else if (resource === 'memory' && itemId && !child && method === 'PUT') response = json(await domain.editMemory(accountId, itemId, await body()));
          else if (resource === 'memory' && itemId && !child && method === 'DELETE') response = json(await domain.editMemory(accountId, itemId, await body(), true));
          else if (resource === 'memory' && itemId && child === 'history' && method === 'GET') response = json({ history: await domain.memoryHistory(accountId, itemId) });
          else if (resource === 'memory' && itemId && child === 'restore' && method === 'POST') response = json(await domain.restoreMemory(accountId, itemId, await body()));
          else if (resource === 'materials' && !itemId && method === 'GET') response = json({ materials: await materials.list(accountId, url.searchParams.get('pathId') ?? undefined) });
          else if (resource === 'materials' && !itemId && method === 'POST') {
            const length = Number(request.headers.get('content-length') ?? 0);
            if (length > config.maxUploadBytes + 128 * 1024) throw new ApiError(413, 'FILE_SIZE', '업로드는 20MB 이하로 제한돼요.');
            response = json(await materials.upload(accountId, await request.formData()), 201);
          }
          else if (resource === 'materials' && itemId && !child && method === 'GET') response = json(publicMaterial(await materials.metadata(accountId, itemId)));
          else if (resource === 'materials' && itemId && child === 'excerpts' && method === 'GET') response = json({ excerpts: await materials.excerpts(accountId, itemId) });
          else if (resource === 'materials' && itemId && child === 'content' && method === 'GET') {
            const material = await materials.metadata(accountId, itemId);
            const bytes = await materials.objects.get(material.objectKey);
            response = new Response(bytes, { headers: { ...headers, 'Content-Type': material.mimeType, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(material.name)}` } });
          }
          else if (resource === 'materials' && itemId && !child && method === 'DELETE') response = json(await materials.remove(accountId, itemId, await body()));
          else if (resource === 'turns' && !itemId && method === 'POST') {
            const input = await agent.begin(accountId, { ...await body() as object, deviceId: context.deviceId });
            const disconnected = new AbortController();
            const encoder = new TextEncoder();
            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                const keepalive = setInterval(() => { try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { disconnected.abort(); } }, 10_000);
                void agent.execute(accountId, input, async event => {
                  if (disconnected.signal.aborted) return;
                  try { controller.enqueue(encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`)); }
                  catch { disconnected.abort(); }
                }, disconnected.signal).finally(() => { clearInterval(keepalive); try { controller.close(); } catch { /* cancelled reader */ } });
              },
              cancel() { disconnected.abort(); },
            });
            response = new Response(stream, { headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
          }
          else if (resource === 'turns' && itemId && !child && method === 'GET') response = json(await agent.record(accountId, itemId));
          else if (resource === 'turns' && itemId && child === 'cancel' && method === 'POST') response = json(await agent.cancel(accountId, itemId));
          else if (resource === 'playback' && method === 'POST') {
            const input = z.object({ turnId: z.string(), chunkId: z.string().optional(), status: z.enum(['STARTED', 'COMPLETED', 'STOPPED', 'FAILED', 'UNKNOWN']), at: z.string().datetime({ offset: true }).optional() }).parse(await body());
            if (input.at && Date.parse(input.at) > Date.now() + 5000) throw new ApiError(400, 'FUTURE_PLAYBACK', '재생 관찰 시각이 올바르지 않아요.');
            await store.write(accountId, async r => {
              requireValue(await r.get('turn', input.turnId));
              if (input.chunkId) { const chunk = requireValue(await r.get<SpeechChunk>('speech-chunk', input.chunkId)); if (chunk.turnId !== input.turnId) throw new ApiError(409, 'CHUNK_MISMATCH', '발화와 재생 조각이 일치하지 않아요.'); }
              const playback: Playback = { ...input, at: input.at ?? now() };
              await r.put('playback', `${input.turnId}:${input.chunkId ?? 'utterance'}:${input.status}`, playback);
            });
            response = json({ ok: true });
          }
          else if (resource === 'narratives' && itemId === 'prepare' && method === 'POST') response = json(await narratives.prepare(accountId, await body()));
          else if (resource === 'narratives' && !itemId && method === 'GET') response = json(await narratives.list(accountId, z.string().min(1).parse(url.searchParams.get('pathId'))));
          else if (resource === 'narratives' && itemId && child === 'status' && method === 'POST') response = json(await narratives.status(accountId, itemId, await body()));
          else if (resource === 'diagnostics' && method === 'GET') {
            response = json(await store.read(accountId, async r => ({ at: now(), actions: await r.list('action'), usage: await r.list('model-usage'), turns: (await r.list<any>('turn')).map(t => ({ turnId: t.turnId, status: t.status, startedAt: t.startedAt, updatedAt: t.updatedAt, error: t.error })), jobs: await r.list('job'), capabilities: { actualNavigation: 'CLIENT_PLEOS', roadGeometry: 'PROVIDER_REQUIRED', imageOcr: 'NOT_CONFIGURED', modelConfigured: !!config.apiKey && !!config.model } })));
          }
          else throw new ApiError(404, 'NOT_FOUND', 'API를 찾을 수 없어요.');
        }
      }
    } catch (error) {
      if (error instanceof ApiError) response = json({ error: { code: error.code, message: error.message } }, error.status);
      else if (error instanceof DirectionsError) response = json({ error: { code: error.code, message: error.message } }, error.status);
      else if (error instanceof z.ZodError) response = json({ error: { code: 'INVALID_INPUT', message: '입력 형식과 필수 항목을 확인해 주세요.', fields: error.issues.map(i => i.path.join('.')) } }, 400);
      else if (error instanceof SyntaxError || error instanceof URIError) response = json({ error: { code: 'INVALID_REQUEST', message: '요청 형식이 올바르지 않아요.' } }, 400);
      else { console.error('agent_request_failed', error instanceof Error ? error.name : 'UnknownError'); response = json({ error: { code: 'INTERNAL_ERROR', message: '요청을 마치지 못했어요. 작업 상태를 확인한 뒤 다시 시도해 주세요.' } }, 500); }
    }
    const origin = request.headers.get('origin');
    if (origin && config.allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.headers.set('Vary', 'Origin');
    }
    return response;
  };
  return { handler, store, auth, domain, materials, agent, narratives, places, close: () => store.close() };
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'JSON 요청이 필요해요.');
  if (Number(request.headers.get('content-length') ?? 0) > 256 * 1024) throw new ApiError(413, 'REQUEST_SIZE', '요청이 너무 커요.');
  const text = await request.text();
  if (text.length > 256 * 1024) throw new ApiError(413, 'REQUEST_SIZE', '요청이 너무 커요.');
  return JSON.parse(text);
}
