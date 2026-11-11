// Vite dev-server middleware so `npm run dev` serves the same /api proxy as Vercel.
// Env is passed in from vite.config.ts (loaded via loadEnv, so non-VITE_ keys stay
// server-only and are never bundled into the client).

import { handleChat, handleTTS, handleConfig } from './handlers.mjs';

export function apiProxy(env) {
  return {
    name: 'pixel-api-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (!path.startsWith('/api/')) return next();
        const run =
          path === '/api/chat' ? handleChat :
          path === '/api/tts' ? handleTTS :
          path === '/api/config' ? handleConfig : null;
        if (!run) { res.statusCode = 404; res.end('not found'); return; }
        Promise.resolve(run(req, res, env)).catch((e) => {
          if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); }
          res.end(JSON.stringify({ error: String((e && e.message) || e) }));
        });
      });
    }
  };
}
