import { readConfig } from './agent/config';
import { createAgentApp } from './agent/http';

const config = readConfig();
const app = await createAgentApp(config);
const server = Bun.serve({
  hostname: config.hostname,
  port: config.port,
  maxRequestBodySize: config.maxUploadBytes + 128 * 1024,
  idleTimeout: 120,
  fetch(request, server) { return app.handler(request, server.requestIP(request)?.address ?? 'unknown'); },
});
console.log(`CARmeleon agent API: http://${config.hostname}:${server.port}/api/v1 (${config.production ? 'production' : 'local development'})`);
const stop = async () => { await server.stop(true); await app.close(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
