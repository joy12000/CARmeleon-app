import type { Plugin } from 'vite';
import { createFallbackApi, type FallbackEnv } from './api';

export function fallbackLivePlugin(env: FallbackEnv): Plugin {
  const handler = createFallbackApi(env);
  return {
    name: 'carmeleon-browser-live',
    configureServer(server) {
      server.middlewares.use('/api/fallback', async (req, res) => {
        try {
          const host = req.headers.host || '';
          // Reject foreign hosts before reading bodies or using credentials.
          const origin = new URL('http://' + host);
          if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
            res.writeHead(403); res.end(); return;
          }
          const chunks: Uint8Array[] = []; let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 128_000) { res.writeHead(413); res.end(); return; }
            chunks.push(chunk);
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
          const method = req.method || 'GET';
          const request = new Request(origin.origin + (req.originalUrl || '/api/fallback' + req.url), {
            method, headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(Buffer.concat(chunks)),
          });
          const response = await handler(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '로컬 음성 서버 연결을 확인해 주세요.' })); }
      });
    },
  };
}
