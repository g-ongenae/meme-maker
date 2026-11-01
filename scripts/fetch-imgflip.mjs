// Scrape https://imgflip.com/memetemplates (all pages) and download each
// template's full-size image into data/raw/imgflip/.
// Writes data/raw/imgflip/index.json with one entry per template.
//
// Usage: node scripts/fetch-imgflip.mjs [--max-pages N] [--concurrency N]

import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const MAX_PAGES = Number(args['max-pages'] ?? 200);
const CONCURRENCY = Number(args.concurrency ?? 6);
const OUT_DIR = path.resolve('data/raw/imgflip');
const UA = 'Mozilla/5.0 (meme-maker personal template fetcher)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, asBuffer = false, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(500 * 2 ** i);
    }
  }
}

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Each card looks like:
// <div class="mt-box"><h3 class="mt-title"><a ... href="/meme/Slug">Name</a></h3>
//   ... <img ... src="//i.imgflip.com/4/30b1gx.jpg"/> ...
function parsePage(html) {
  const cards = html.split('class="mt-box"').slice(1);
  return cards.flatMap((card) => {
    const title = card.match(/class="mt-title">\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/);
    const img = card.match(/<img[^>]*src="([^"]+)"/);
    if (!title || !img) return [];
    // Thumbnails live under /4/ (or /2/); the full-size image drops that prefix.
    // Some (restricted) entries use a relative /i-view/ URL instead; skip them.
    const m = img[1].match(/^\/\/i\.imgflip\.com\/\d+\/(\w+)\.\w+$/);
    if (!m) return [];
    return [{
      id: m[1],
      name: decode(title[2].trim()),
      slug: title[1].replace(/^\/meme\//, ''),
      pageUrl: `https://imgflip.com${title[1]}`,
    }];
  });
}

// The thumbnail is always .jpg, but the original may be .jpg, .png or .gif.
// Fall back to imgflip's larger /2/ thumbnail if none of those exist.
const candidates = (id) => [
  `https://i.imgflip.com/${id}.jpg`,
  `https://i.imgflip.com/${id}.png`,
  `https://i.imgflip.com/${id}.gif`,
  `https://i.imgflip.com/2/${id}.jpg`,
];
const fileFor = (id, url) => (url.includes('/2/') ? `${id}.thumb.jpg` : `${id}.${url.split('.').pop()}`);

async function download(t) {
  for (const url of candidates(t.id)) {
    const file = fileFor(t.id, url);
    const dest = path.join(OUT_DIR, file);
    if (await access(dest).then(() => true, () => false)) {
      return Object.assign(t, { url, file, thumbnailOnly: url.includes('/2/') });
    }
  }
  for (const url of candidates(t.id)) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const file = fileFor(t.id, url);
    await writeFile(path.join(OUT_DIR, file), Buffer.from(await res.arrayBuffer()));
    return Object.assign(t, { url, file, thumbnailOnly: url.includes('/2/') });
  }
  throw new Error('no image found');
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const templates = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchWithRetry(`https://imgflip.com/memetemplates?page=${page}`);
    const found = parsePage(html);
    if (found.length === 0) break;
    for (const t of found) templates.push({ ...t, rank: templates.length + 1, page });
    process.stdout.write(`\rpage ${page}: ${templates.length} templates`);
    await sleep(300);
  }
  console.log();

  // Rankings shift while paginating, so the same template can appear twice.
  const byId = new Map();
  for (const t of templates) if (!byId.has(t.id)) byId.set(t.id, t);
  const unique = [...byId.values()];
  console.log(`${templates.length} entries, ${unique.length} unique ids`);

  let done = 0, failed = 0;
  await pool(unique, CONCURRENCY, async (t) => {
    try {
      await download(t);
    } catch (err) {
      t.error = err.message;
      failed++;
    }
    process.stdout.write(`\rdownloaded ${++done}/${unique.length} (${failed} failed)`);
  });
  console.log();

  await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(unique, null, 2));
  console.log(`wrote ${path.join(OUT_DIR, 'index.json')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
