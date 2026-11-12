import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp, parseRange, safeName } from './app.ts';

describe('parseRange', () => {
  it('ignores missing, malformed and empty ranges', () => {
    assert.equal(parseRange(undefined, 100), null);
    assert.equal(parseRange('bytes=-', 100), null);
    assert.equal(parseRange('bytes=0-1,5-6', 100), null);
    assert.equal(parseRange('items=0-1', 100), null);
  });

  it('parses bounded, open-ended and suffix ranges', () => {
    assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
    assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
    assert.deepEqual(parseRange('bytes=-30', 100), { start: 70, end: 99 });
  });

  it('clamps to the end of the file', () => {
    assert.deepEqual(parseRange('bytes=50-500', 100), { start: 50, end: 99 });
    assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
  });

  it('rejects ranges past the end', () => {
    assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  });
});

describe('safeName', () => {
  it('accepts bare image names, decoded', () => {
    assert.equal(safeName('drake.jpg', false), 'drake.jpg');
    assert.equal(safeName('a%20b.PNG', false), 'a b.PNG');
  });

  it('accepts videos only where allowed', () => {
    assert.equal(safeName('kid.mp4', true), 'kid.mp4');
    assert.equal(safeName('kid.mp4', false), null);
  });

  it('rejects paths, hidden files, other types and bad encodings', () => {
    for (const name of [
      '..%2Fsecret.jpg',
      'sub%2Fa.jpg',
      '.hidden.jpg',
      'index.json',
      'a.html',
      '%E0%A4%A.jpg',
    ]) {
      assert.equal(safeName(name, true), null, name);
    }
  });
});

describe('createApp', () => {
  let root: string;
  let server: Server;
  let base: string;
  const index = [{ id: 'drake', name: 'Drake' }];
  const characters = [{ id: 'dog', name: 'Dog', file: 'dog.png', template: 'drake' }];
  const video = Buffer.from('0123456789abcdef');

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'meme-maker-'));
    const templates = path.join(root, 'data/templates');
    const charactersDir = path.join(root, 'data/characters');
    await Promise.all(
      ['public', 'assets', 'dist/client', 'data/templates', 'data/characters'].map((d) =>
        mkdir(path.join(root, d), { recursive: true }),
      ),
    );
    await Promise.all([
      writeFile(path.join(root, 'public/index.html'), '<!doctype html><title>Meme templates</title>'),
      writeFile(path.join(root, 'public/style.css'), 'body {}'),
      writeFile(path.join(root, 'assets/icon.svg'), '<svg/>'),
      writeFile(path.join(root, 'dist/client/main.js'), 'export {};'),
      writeFile(path.join(templates, 'index.json'), JSON.stringify(index)),
      writeFile(path.join(templates, 'kid.mp4'), video),
      sharp({ create: { width: 800, height: 600, channels: 3, background: '#e11d48' } })
        .jpeg()
        .toFile(path.join(templates, 'drake.jpg')),
      writeFile(path.join(charactersDir, 'index.json'), JSON.stringify(characters)),
      sharp({ create: { width: 600, height: 800, channels: 4, background: '#0000' } })
        .png()
        .toFile(path.join(charactersDir, 'dog.png')),
    ]);

    const handle = createApp({ root, sharp: Promise.resolve(sharp) });
    server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  const get = (url: string, init?: RequestInit) => fetch(base + url, init);

  it('serves the page, its stylesheet, script and icon', async () => {
    for (const [url, type] of [
      ['/', 'text/html; charset=utf-8'],
      ['/style.css', 'text/css; charset=utf-8'],
      ['/js/main.js', 'text/javascript; charset=utf-8'],
      ['/icon.svg', 'image/svg+xml'],
    ]) {
      const res = await get(url);
      assert.equal(res.status, 200, url);
      assert.equal(res.headers.get('content-type'), type, url);
      await res.arrayBuffer();
    }
  });

  it('serves the template index', async () => {
    const res = await get('/api/templates');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), index);
  });

  it('serves the character index', async () => {
    const res = await get('/api/characters');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), characters);
  });

  it('serves characters and their transparent thumbnails', async () => {
    const img = await get('/img/characters/dog.png');
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    await img.arrayBuffer();

    const thumb = await get('/thumb/characters/dog.png');
    assert.equal(thumb.status, 200);
    const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ['webp', 300, 400, true]);
    const cached = await sharp(path.join(root, 'data/thumbs/characters/dog.png.webp')).metadata();
    assert.equal(cached.height, 400);
  });

  it('answers 404 for unknown files and routes', async () => {
    for (const url of [
      '/js/missing.js',
      '/js/../app.ts',
      '/img/missing.jpg',
      '/img/index.json',
      '/img/characters/drake.jpg',
      '/img/characters/index.json',
      '/img/other/drake.jpg',
      '/nope',
    ]) {
      const res = await get(url);
      assert.equal(res.status, 404, url);
      await res.arrayBuffer();
    }
  });

  it('only allows GET and HEAD', async () => {
    const res = await get('/', { method: 'POST' });
    assert.equal(res.status, 405);
    await res.arrayBuffer();
  });

  it('revalidates with ETags', async () => {
    const first = await get('/img/kid.mp4');
    await first.arrayBuffer();
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const second = await get('/img/kid.mp4', { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 304);
  });

  it('serves byte ranges', async () => {
    const res = await get('/img/kid.mp4', { headers: { Range: 'bytes=4-7' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 4-7/${video.length}`);
    assert.equal(await res.text(), '4567');

    const bad = await get('/img/kid.mp4', { headers: { Range: 'bytes=999-' } });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers.get('content-range'), `bytes */${video.length}`);
  });

  it('ignores a range for a stale If-Range', async () => {
    const res = await get('/img/kid.mp4', { headers: { Range: 'bytes=4-7', 'If-Range': '"stale"' } });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), video.toString());
  });

  it('renders and caches thumbnails', async () => {
    const res = await get('/thumb/drake.jpg');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 400, 300]);
    const cached = await sharp(path.join(root, 'data/thumbs/drake.jpg.webp')).metadata();
    assert.equal(cached.width, 400);
  });

  it('answers 404 for the thumbnail of a missing image', async () => {
    const res = await get('/thumb/missing.jpg');
    assert.equal(res.status, 404);
    await res.arrayBuffer();
  });
});
