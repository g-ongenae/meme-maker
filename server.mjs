// Tiny zero-dependency server for browsing the crawled templates.
//
//   GET /                 → public/index.html
//   GET /api/templates    → data/templates/index.json
//   GET /img/<file>       → full-size image from data/templates/
//   GET /thumb/<file>     → 400px WebP thumbnail, generated on demand with sharp
//                           and cached in data/thumbs/
//
// Usage: node server.mjs   (PORT and HOST env vars override 4321 / 127.0.0.1)

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(ROOT, 'data/templates');
const THUMBS_DIR = path.join(ROOT, 'data/thumbs');
const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? '127.0.0.1';
const THUMB_SIZE = 400;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// sharp is only needed for thumbnails; without it the page gets the originals.
// Its native library can take seconds to load cold, so it loads in the
// background instead of delaying startup.
const sharpReady = import('sharp').then((m) => m.default, () => {
  console.warn('sharp not installed: serving full-size images as thumbnails');
  return null;
});

function sendText(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

// Streams a file with an ETag so the browser revalidates cheaply and still
// picks up changes after the crawl scripts are re-run.
async function sendFile(req, res, file) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return sendText(res, 404, 'Not found');

  const etag = `"${info.size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}"`;
  const headers = { ETag: etag, 'Cache-Control': 'no-cache' };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, {
    ...headers,
    'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// Only bare image file names are accepted, so a request can never leave the
// directory (or fetch index.json through the image routes).
function safeName(encoded) {
  let name;
  try {
    name = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  const ok = name === path.basename(name) && !name.startsWith('.') &&
    TYPES[path.extname(name).toLowerCase()]?.startsWith('image/');
  return ok ? name : null;
}

const pendingThumbs = new Map();

async function thumbnail(sharp, name) {
  const src = path.join(TEMPLATES_DIR, name);
  const dest = path.join(THUMBS_DIR, `${name}.webp`);
  const [srcInfo, destInfo] = await Promise.all([stat(src), stat(dest).catch(() => null)]);
  if (destInfo && destInfo.mtimeMs >= srcInfo.mtimeMs) return dest;

  // Several requests for the same missing thumbnail share one render.
  if (!pendingThumbs.has(name)) {
    const tmp = path.join(THUMBS_DIR, `.${process.pid}.${name}.webp`);
    const job = mkdir(THUMBS_DIR, { recursive: true })
      .then(() => sharp(src)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(tmp))
      .then(() => rename(tmp, dest))
      .then(() => dest)
      .finally(() => pendingThumbs.delete(name));
    pendingThumbs.set(name, job);
  }
  return pendingThumbs.get(name);
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/') return sendFile(req, res, path.join(ROOT, 'public/index.html'));
  if (pathname === '/icon.svg') return sendFile(req, res, path.join(ROOT, 'assets/icon.svg'));
  if (pathname === '/api/templates') return sendFile(req, res, path.join(TEMPLATES_DIR, 'index.json'));

  const match = pathname.match(/^\/(img|thumb)\/([^/]+)$/);
  const name = match && safeName(match[2]);
  if (!name) return sendText(res, 404, 'Not found');

  const original = path.join(TEMPLATES_DIR, name);
  const sharp = match[1] === 'thumb' ? await sharpReady : null;
  if (!sharp) return sendFile(req, res, original);
  try {
    return await sendFile(req, res, await thumbnail(sharp, name));
  } catch (err) {
    if (err.code === 'ENOENT') return sendText(res, 404, 'Not found');
    console.warn(`thumbnail failed for ${name}: ${err.message}`);
    return sendFile(req, res, original);
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendText(res, 500, 'Internal error');
    else res.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`meme templates → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
