const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const DIST_DIR = path.join(__dirname, 'dist');
const ROOT_DIR = fs.existsSync(DIST_DIR) ? DIST_DIR : __dirname;
const BLOCKED_STATIC_NAMES = new Set([
  'server.js', 'server.cjs', 'server.ts', 'package.json',
  'package-lock.json', 'tsconfig.json', '.env', '.env.local'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    let pathname;
    try {
      pathname = decodeURIComponent(parsedUrl.pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }

    if (pathname === '/healthz' || pathname === '/_ah/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('OK');
      return;
    }

    // Backend proxy: same handlers as the Vercel functions / Vite dev middleware.
    if (pathname.startsWith('/api/')) {
      const run = pathname === '/api/chat' ? 'handleChat'
        : pathname === '/api/tts' ? 'handleTTS'
        : pathname === '/api/config' ? 'handleConfig' : null;
      import('./server/handlers.mjs')
        .then((m) => {
          if (!run) { res.statusCode = 404; res.end('not found'); return; }
          return m[run](req, res, process.env);
        })
        .catch((e) => {
          if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); }
          res.end(JSON.stringify({ error: String((e && e.message) || e) }));
        });
      return;
    }

    if (pathname === '/') {
      pathname = '/index.html';
    }

    const segs = pathname.split('/').filter(Boolean);
    if (
      segs.some((seg) => seg.startsWith('.') || seg === 'node_modules') ||
      (segs.length > 0 && BLOCKED_STATIC_NAMES.has(segs[segs.length - 1].toLowerCase()))
    ) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    // Prevent directory traversal
    let filePath = path.resolve(ROOT_DIR, '.' + (pathname.startsWith('/') ? pathname : '/' + pathname));

    // Ensure the resolved path stays inside ROOT_DIR
    if (filePath !== ROOT_DIR && !filePath.startsWith(ROOT_DIR + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      // Fallback to index.html for SPA navigation
      const fallbackPath = path.join(ROOT_DIR, 'index.html');
      if (fs.existsSync(fallbackPath)) {
        filePath = fallbackPath;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const responseHeaders = {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    };
    if (ext === '.svg') {
      responseHeaders['X-Content-Type-Options'] = 'nosniff';
      responseHeaders['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox";
    }
    res.writeHead(200, responseHeaders);

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error');
    });
    stream.pipe(res);
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT} (serving ${ROOT_DIR})`);
});
