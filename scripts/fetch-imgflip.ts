// Scrape https://imgflip.com/memetemplates (all pages) and download each
// template's full-size image into data/raw/imgflip/.
// Writes data/raw/imgflip/index.json with one entry per template.
//
// Usage: npm run fetch:imgflip -- [--max-pages N] [--concurrency N]

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { type RawTemplate, candidates, fileFor, isThumbnailUrl, parsePage } from './imgflip.ts';

const { values: args } = parseArgs({
  options: { 'max-pages': { type: 'string' }, concurrency: { type: 'string' } },
});
const MAX_PAGES = Number(args['max-pages'] ?? 200);
const CONCURRENCY = Number(args.concurrency ?? 6);
const OUT_DIR = path.resolve('data/raw/imgflip');
const UA = 'Mozilla/5.0 (meme-maker personal template fetcher)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function fetchText(url: string, tries = 4): Promise<string> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${message(err)}`, { cause: err });
      await sleep(500 * 2 ** i);
    }
  }
}

async function download(t: RawTemplate): Promise<void> {
  for (const url of candidates(t)) {
    const file = fileFor(t.id, url);
    if (
      await access(path.join(OUT_DIR, file)).then(
        () => true,
        () => false,
      )
    ) {
      Object.assign(t, { url, file, thumbnailOnly: isThumbnailUrl(url) });
      return;
    }
  }
  for (const url of candidates(t)) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const file = fileFor(t.id, url);
    await writeFile(path.join(OUT_DIR, file), Buffer.from(await res.arrayBuffer()));
    Object.assign(t, { url, file, thumbnailOnly: isThumbnailUrl(url) });
    return;
  }
  throw new Error('no image found');
}

async function isAnimated(id: string): Promise<boolean> {
  const res = await fetch(`https://i.imgflip.com/${id}.mp4`, {
    method: 'HEAD',
    headers: { 'User-Agent': UA },
  });
  if (res.status !== 404 && !res.ok) throw new Error(`${id}.mp4: HTTP ${res.status}`);
  return res.ok;
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const templates: RawTemplate[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchText(`https://imgflip.com/memetemplates?page=${page}`);
    const found = parsePage(html);
    if (found.length === 0) break;
    for (const t of found) templates.push({ ...t, rank: templates.length + 1, page });
    process.stdout.write(`\rpage ${page}: ${templates.length} templates`);
    await sleep(300);
  }
  console.log();

  // Rankings shift while paginating, so the same template can appear twice.
  const byId = new Map<string, RawTemplate>();
  for (const t of templates) if (!byId.has(t.id)) byId.set(t.id, t);
  const fresh = byId.size;

  // The listing only shows what is currently popular, so templates drop in
  // and out of it between runs. Keep the ones a previous run already knew.
  const indexFile = path.join(OUT_DIR, 'index.json');
  const previous = JSON.parse(await readFile(indexFile, 'utf8').catch(() => '[]')) as RawTemplate[];
  for (const t of previous) {
    if (byId.has(t.id)) continue;
    delete t.error;
    // Entries from before animated templates were detected: imgflip serves
    // every animated template as an .mp4, and no static one.
    t.animated ??= await isAnimated(t.id);
    byId.set(t.id, t);
  }
  const unique = [...byId.values()];
  console.log(
    `${templates.length} entries, ${fresh} unique ids, ${unique.length - fresh} kept from the previous run`,
  );

  let done = 0;
  let failed = 0;
  await pool(unique, CONCURRENCY, async (t) => {
    try {
      await download(t);
    } catch (err) {
      t.error = message(err);
      failed++;
    }
    process.stdout.write(`\rdownloaded ${++done}/${unique.length} (${failed} failed)`);
  });
  console.log();

  await writeFile(indexFile, JSON.stringify(unique, null, 2));
  console.log(`wrote ${indexFile}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
