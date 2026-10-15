import { defineConfig, loadEnv } from 'vite';
import { Readable } from 'node:stream';
import share from './api/share.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['KV_REST_API_', 'UPSTASH_REDIS_REST_']);
  for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
  return { plugins: [{
    name: 'local-share-api',
    configureServer(server) {
      server.middlewares.use('/api/share', async (req, res) => {
        try {
          const request = new Request(`http://${req.headers.host}/api/share${req.url}`, {
            method: req.method, headers: req.headers,
            ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }),
          });
          const response = await share.fetch(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch { res.writeHead(500); res.end('分享服务暂时不可用'); }
      });
    },
  }] };
});
