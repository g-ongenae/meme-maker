// Tiny server for browsing the crawled templates (see app.ts for the routes).
//
// Usage: npm start   (PORT and HOST env vars override 4321 / 127.0.0.1)

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? '127.0.0.1';

const handle = createApp({ root: ROOT });

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal error');
    } else {
      res.destroy();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`meme templates → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
