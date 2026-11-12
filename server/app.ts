// Request handler for browsing the crawled templates.
//
//   GET /                 → public/index.html
//   GET /style.css        → public/style.css
//   GET /icon.svg         → assets/icon.svg
//   GET /js/<file>.js     → the compiled client (dist/client/, `npm run build`)
//   GET /api/templates    → data/templates/index.json
//   GET /api/characters   → data/characters/index.json
//   GET /img/<file>       → full-size image (or .mp4 animated template) from
//                           data/templates/, with Range support for videos
//   GET /thumb/<file>     → 400px WebP thumbnail of an image, generated on
//                           demand with sharp and cached in data/thumbs/
//                           (animated templates use their .poster.jpg)
//   GET /img/characters/<file>, /thumb/characters/<file>
//                         → the same for the characters in data/characters/
//                           (thumbnails cached in data/thumbs/characters/)

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Sharp, SharpOptions } from 'sharp';

type SharpFactory = (input: string, options?: SharpOptions) => Sharp;

export interface AppOptions {
  /** Project root: public/, assets/ and dist/client/ are resolved from it. */
  root: string;
  /** Defaults to <root>/data/templates. */
  templatesDir?: string;
  /** Defaults to <root>/data/characters. */
  charactersDir?: string;
  /** Defaults to <root>/data/thumbs. */
  thumbsDir?: string;
  /** Resolves to sharp, or null to serve originals as thumbnails. */
  sharp?: Promise<SharpFactory | null>;
}

/** Where a collection's images are, and where their thumbnails are cached. */
interface Collection {
  dir: string;
  thumbs: string;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const THUMB_SIZE = 400;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

const typeOf = (file: string): string | undefined => TYPES[path.extname(file).toLowerCase()];

// sharp is only needed for thumbnails; without it the page gets the originals.
// Its native library can take seconds to load cold, so callers start loading
// it in the background instead of delaying startup.
export function loadSharp(): Promise<SharpFactory | null> {
  return import('sharp').then(
    (m) => m.default,
    () => {
      console.warn('sharp not installed: serving full-size images as thumbnails');
      return null;
    },
  );
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

export interface ByteRange {
  start: number;
  end: number;
}

// Parses a single-range `Range: bytes=…` header against a file of `size`
// bytes. Returns null when the header should be ignored (absent, malformed or
// multi-range) and 'unsatisfiable' for a range past the end of the file.
export function parseRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  const range = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range || (!range[1] && !range[2])) return null;
  let start: number;
  let end = size - 1;
  if (range[1]) {
    start = Number(range[1]);
    if (range[2]) end = Math.min(end, Number(range[2]));
  } else {
    start = Math.max(0, size - Number(range[2]));
  }
  return start > end ? 'unsatisfiable' : { start, end };
}

// Streams a file with an ETag so the browser revalidates cheaply and still
// picks up changes after the crawl scripts are re-run. Single byte ranges are
// honoured, since browsers (Safari in particular) need them to play videos.
async function sendFile(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return sendText(res, 404, 'Not found');

  const etag = `"${info.size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}"`;
  const headers: OutgoingHttpHeaders = { ETag: etag, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  let start = 0;
  let end = info.size - 1;
  let status = 200;
  const ifRange = req.headers['if-range'];
  const range = !ifRange || ifRange === etag ? parseRange(req.headers.range, info.size) : null;
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` });
    res.end();
    return;
  }
  if (range) {
    ({ start, end } = range);
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }

  res.writeHead(status, {
    ...headers,
    'Content-Type': typeOf(file) ?? 'application/octet-stream',
    'Content-Length': end - start + 1,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file, { start, end })
    .on('error', () => res.destroy())
    .pipe(res);
}

// Only bare image (or, for /img/, video) file names are accepted, so a
// request can never leave the directory (or fetch index.json through the
// image routes).
export function safeName(encoded: string, allowVideo: boolean): string | null {
  let name: string;
  try {
    name = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  const type = typeOf(name) ?? '';
  const ok =
    name === path.basename(name) &&
    !name.startsWith('.') &&
    (type.startsWith('image/') || (allowVideo && type.startsWith('video/')));
  return ok ? name : null;
}

export function createApp({
  root,
  templatesDir = path.join(root, 'data/templates'),
  charactersDir = path.join(root, 'data/characters'),
  thumbsDir = path.join(root, 'data/thumbs'),
  sharp = loadSharp(),
}: AppOptions): Handler {
  const clientDir = path.join(root, 'dist/client');
  const routes: Record<string, string> = {
    '/': path.join(root, 'public/index.html'),
    '/style.css': path.join(root, 'public/style.css'),
    '/icon.svg': path.join(root, 'assets/icon.svg'),
    '/api/templates': path.join(templatesDir, 'index.json'),
    '/api/characters': path.join(charactersDir, 'index.json'),
  };
  // Image collections: the templates, and the characters cut out of them.
  const templates: Collection = { dir: templatesDir, thumbs: thumbsDir };
  const characters: Collection = { dir: charactersDir, thumbs: path.join(thumbsDir, 'characters') };
  const pendingThumbs = new Map<string, Promise<string>>();

  async function thumbnail(sharp: SharpFactory, { dir, thumbs }: Collection, name: string): Promise<string> {
    const src = path.join(dir, name);
    const dest = path.join(thumbs, `${name}.webp`);
    const [srcInfo, destInfo] = await Promise.all([stat(src), stat(dest).catch(() => null)]);
    if (destInfo && destInfo.mtimeMs >= srcInfo.mtimeMs) return dest;

    // Several requests for the same missing thumbnail share one render.
    let job = pendingThumbs.get(dest);
    if (!job) {
      const tmp = path.join(thumbs, `.${process.pid}.${name}.webp`);
      job = mkdir(thumbs, { recursive: true })
        .then(() =>
          sharp(src)
            .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 78 })
            .toFile(tmp),
        )
        .then(() => rename(tmp, dest))
        .then(() => dest)
        .finally(() => pendingThumbs.delete(dest));
      pendingThumbs.set(dest, job);
    }
    return job;
  }

  return async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    const route = routes[pathname];
    if (route) return sendFile(req, res, route);

    const script = pathname.match(/^\/js\/([\w-]+\.js)$/);
    if (script) return sendFile(req, res, path.join(clientDir, script[1]));

    const match = pathname.match(/^\/(img|thumb)\/(characters\/)?([^/]+)$/);
    const name = match && safeName(match[3], match[1] === 'img' && !match[2]);
    if (!match || !name) return sendText(res, 404, 'Not found');

    const collection = match[2] ? characters : templates;
    const original = path.join(collection.dir, name);
    const sharpFn = match[1] === 'thumb' ? await sharp : null;
    if (!sharpFn) return sendFile(req, res, original);
    try {
      return await sendFile(req, res, await thumbnail(sharpFn, collection, name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return sendText(res, 404, 'Not found');
      console.warn(`thumbnail failed for ${name}: ${(err as Error).message}`);
      return sendFile(req, res, original);
    }
  };
}
