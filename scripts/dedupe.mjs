// Remove duplicate templates from data/raw/imgflip/ and write the cleaned set
// to data/templates/ (images + index.json), plus data/duplicates.html so the
// merged groups can be reviewed visually.
//
// Two images are duplicates when their perceptual hashes (dHash, 64-bit) are
// within --threshold bits, their 16×16 colour thumbnails are close, AND their
// aspect ratios are within 8% of each other.
// In each group the most popular template (lowest imgflip rank) keeps its name;
// the highest-resolution image in the group is kept as the file.
//
// Usage: node scripts/dedupe.mjs [--threshold 6]

import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const thresholdArg = process.argv.indexOf('--threshold');
const THRESHOLD = thresholdArg > -1 ? Number(process.argv[thresholdArg + 1]) : 6;
const MAX_COLOR_DISTANCE = 18; // mean per-channel difference, 0–255
const RAW_DIR = path.resolve('data/raw/imgflip');
const OUT_DIR = path.resolve('data/templates');

async function dHash(file) {
  const px = await sharp(file, { animated: false })
    .flatten({ background: '#fff' })
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return h;
}

// 16×16 RGB thumbnail, used to reject dHash collisions between low-detail
// images (solid backgrounds, half-blank panels) whose colours or content differ.
async function colorThumb(file) {
  return sharp(file, { animated: false })
    .flatten({ background: '#fff' })
    .removeAlpha()
    .resize(16, 16, { fit: 'fill' })
    .raw()
    .toBuffer();
}

const colorDistance = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
};

const popcount = (n) => {
  let c = 0;
  for (; n; n &= n - 1n) c++;
  return c;
};

const slugify = (s) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'template';

async function main() {
  const index = JSON.parse(await readFile(path.join(RAW_DIR, 'index.json'), 'utf8'))
    .filter((t) => t.file && !t.error);

  console.log(`hashing ${index.length} images...`);
  const items = [];
  for (const t of index) {
    const file = path.join(RAW_DIR, t.file);
    try {
      const buf = await readFile(file);
      const meta = await sharp(buf).metadata();
      items.push({
        ...t,
        width: meta.width,
        height: meta.pageHeight ?? meta.height,
        sha256: createHash('sha256').update(buf).digest('hex'),
        hash: await dHash(buf),
        thumb: await colorThumb(buf),
      });
    } catch (err) {
      console.warn(`skip ${t.file}: ${err.message}`);
    }
  }

  // Union-find over all pairs (n≈2k → ~2M comparisons, fast enough).
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      const same = a.sha256 === b.sha256 || (
        popcount(a.hash ^ b.hash) <= THRESHOLD &&
        colorDistance(a.thumb, b.thumb) <= MAX_COLOR_DISTANCE &&
        Math.abs(a.width / a.height - b.width / b.height) / (a.width / a.height) < 0.08
      );
      if (same) parent[find(j)] = find(i);
    }
  }

  const groups = new Map();
  items.forEach((it, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(it);
  });

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const usedSlugs = new Set();
  const templates = [];
  const dupGroups = [];
  for (const members of groups.values()) {
    members.sort((a, b) => a.rank - b.rank);
    const canonical = members[0];
    const best = members.reduce((m, x) => (x.width * x.height > m.width * m.height ? x : m));

    let slug = slugify(canonical.name);
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(canonical.name)}-${n}`;
    usedSlugs.add(slug);

    const file = `${slug}${path.extname(best.file)}`;
    await copyFile(path.join(RAW_DIR, best.file), path.join(OUT_DIR, file));

    templates.push({
      id: slug,
      name: canonical.name,
      file,
      width: best.width,
      height: best.height,
      rank: canonical.rank,
      source: { site: 'imgflip', id: best.id, pageUrl: canonical.pageUrl },
      aliases: [...new Set(members.slice(1).map((m) => m.name))].filter((n) => n !== canonical.name),
    });
    if (members.length > 1) dupGroups.push({ keep: canonical, best, members });
  }

  templates.sort((a, b) => a.rank - b.rank);
  await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(templates, null, 2));
  await writeFile(path.resolve('data/duplicates.html'), renderReport(dupGroups));

  const removed = items.length - templates.length;
  console.log(`${items.length} images → ${templates.length} templates (${removed} duplicates in ${dupGroups.length} groups)`);
  console.log(`wrote ${OUT_DIR}/index.json and data/duplicates.html`);
}

function renderReport(groups) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows = groups
    .sort((a, b) => b.members.length - a.members.length || a.keep.rank - b.keep.rank)
    .map((g) => `<section><h2>${esc(g.keep.name)} <small>(${g.members.length})</small></h2><div>${
      g.members.map((m) => `<figure class="${m === g.best ? 'best' : ''}">
        <img loading="lazy" src="raw/imgflip/${esc(m.file)}">
        <figcaption>#${m.rank} ${esc(m.name)}<br>${m.width}×${m.height}</figcaption></figure>`).join('')
    }</div></section>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Duplicate groups</title>
<style>
body{font:14px system-ui;margin:24px;background:#111;color:#eee}
section{border-top:1px solid #333;padding:8px 0}
h2{font-size:15px;margin:4px 0}small{color:#888}
section>div{display:flex;gap:12px;flex-wrap:wrap}
figure{margin:0;width:160px}figure img{width:160px;height:160px;object-fit:contain;background:#222}
figure.best img{outline:3px solid #4ade80}
figcaption{font-size:12px;color:#aaa}
</style>
<h1>${groups.length} duplicate groups</h1><p>Green outline = image kept (highest resolution). Name kept = lowest rank.</p>
${rows}`;
}

main().catch((e) => { console.error(e); process.exit(1); });
