// Remove duplicate templates from data/raw/imgflip/ and write the cleaned set
// to data/templates/ (images + index.json), plus data/duplicates.html so the
// merged groups can be reviewed visually.
//
// Every image (or the first frame of an animated .mp4 template) is first
// trimmed of uniform borders, then two templates are duplicates when either:
//   - "same":   their perceptual hashes (dHash, 64-bit) are within --threshold
//               bits, their 16×16 colour thumbnails are close, and their aspect
//               ratios are within 8% of each other;
//   - "crop":   one is a crop of the other: found by normalized
//               cross-correlation over positions and scales, then confirmed by
//               comparing hashes and colours of the matched region;
//   - "manual": they are listed together under "same" in
//               scripts/duplicates.json (for duplicates no image comparison
//               can see, e.g. swapped panels). Pairs listed under "different"
//               are never matched automatically.
// In each group the most popular template (lowest imgflip rank) keeps its name.
// The file kept is the one with the most pixels, among the members that are
// animated (or static) like that most popular one.
//
// Usage: node scripts/dedupe.mjs [--threshold 6]
//        node scripts/dedupe.mjs --explain <imgflip id>,<imgflip id>   (why two images do or do not match)

import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';

const thresholdArg = process.argv.indexOf('--threshold');
const THRESHOLD = thresholdArg > -1 ? Number(process.argv[thresholdArg + 1]) : 6;
const explainArg = process.argv.indexOf('--explain');
const EXPLAIN = explainArg > -1 ? process.argv[explainArg + 1].split(',') : null;
const MAX_COLOR_DISTANCE = 18; // mean per-channel difference, 0–255
const RAW_DIR = path.resolve('data/raw/imgflip');
const OUT_DIR = path.resolve('data/templates');
const MANUAL_FILE = path.resolve('scripts/duplicates.json');

// Crop detection. A crop must cover at least MIN_CROP_AREA of the larger
// image; matches that look like a subset of its panels are rejected too
// (see panelSubset()).
const MIN_HIST_OVERLAP = 0.75; // colour histogram intersection, pre-filter
const MIN_NCC = 0.9;
const MIN_CROP_AREA = 0.4;
const CROP_THRESHOLD = 10; // dHash bits, on the aligned region
const CROP_MAX_COLOR_DISTANCE = 20;
const MAX_PANEL_ROWS_AREA = 0.8; // see panelSubset()
const MAX_PANEL_COLUMNS_AREA = 0.6;

const WORK = 96; // long side of the trimmed RGB copy every feature is computed from
const NCC_SIZE = 32;

const execFileAsync = promisify(execFile);
const FFMPEG = process.env.FFMPEG ??
  await import('ffmpeg-static').then((m) => m.default ?? 'ffmpeg', () => 'ffmpeg');

const isVideo = (file) => path.extname(file).toLowerCase() === '.mp4';

// First frame of a video, as PNG.
async function videoFrame(file) {
  const { stdout } = await execFileAsync(FFMPEG, [
    '-v', 'error', '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-',
  ], { encoding: 'buffer', maxBuffer: 1 << 28 });
  return stdout;
}

// Bounding box of the image once uniform borders (white margins, black frame
// lines, letterboxing…) are peeled off, layer by layer. A row or column is a
// border when nearly all its pixels share its first pixel's colour.
function trimBox(px, width, height) {
  const at = (x, y) => (y * width + x) * 3;
  const uniform = (x0, y0, dx, dy, n) => {
    const r = at(x0, y0);
    let off = 0;
    for (let i = 0, x = x0, y = y0; i < n; i++, x += dx, y += dy) {
      const p = at(x, y);
      if (Math.abs(px[p] - px[r]) + Math.abs(px[p + 1] - px[r + 1]) + Math.abs(px[p + 2] - px[r + 2]) > 60) {
        if (++off > n * 0.02) return false;
      }
    }
    return true;
  };
  let left = 0, top = 0, right = width, bottom = height;
  for (let changed = true; changed;) {
    changed = false;
    while (bottom - top > 2 && uniform(left, top, 1, 0, right - left)) top++, changed = true;
    while (bottom - top > 2 && uniform(left, bottom - 1, 1, 0, right - left)) bottom--, changed = true;
    while (right - left > 2 && uniform(left, top, 0, 1, bottom - top)) left++, changed = true;
    while (right - left > 2 && uniform(right - 1, top, 0, 1, bottom - top)) right--, changed = true;
  }
  // A mostly blank image would be trimmed to a sliver: keep it whole instead.
  if ((right - left) * (bottom - top) < width * height * 0.3) return { left: 0, top: 0, width, height };
  return { left, top, width: right - left, height: bottom - top };
}

// Box-filter resample of the rectangle [x0,x1)×[y0,y1) of a w×h image with
// `ch` channels into a dw×dh image.
function resample(src, w, ch, x0, y0, x1, y1, dw, dh) {
  const out = new Float32Array(dw * dh * ch);
  const h = src.length / (w * ch);
  const sx = (x1 - x0) / dw, sy = (y1 - y0) / dh;
  for (let y = 0; y < dh; y++) {
    const ya = Math.min(h - 1, Math.floor(y0 + y * sy));
    const yb = Math.min(h, Math.max(ya + 1, Math.ceil(y0 + (y + 1) * sy)));
    for (let x = 0; x < dw; x++) {
      const xa = Math.min(w - 1, Math.floor(x0 + x * sx));
      const xb = Math.min(w, Math.max(xa + 1, Math.ceil(x0 + (x + 1) * sx)));
      for (let c = 0; c < ch; c++) {
        let sum = 0;
        for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) sum += src[(yy * w + xx) * ch + c];
        out[(y * dw + x) * ch + c] = sum / ((yb - ya) * (xb - xa));
      }
    }
  }
  return out;
}

const fit = (w, h, size) => (w >= h
  ? [size, Math.max(4, Math.round((size * h) / w))]
  : [Math.max(4, Math.round((size * w) / h)), size]);

// dHash, 16×16 colour thumbnail, 64-bin colour histogram and the small
// grayscale used for crop search, all from a region of a features object.
function describe(f, x0 = 0, y0 = 0, x1 = f.w, y1 = f.h) {
  const g = resample(f.gray, f.w, 1, x0, y0, x1, y1, 9, 8);
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) hash = (hash << 1n) | (g[y * 9 + x] > g[y * 9 + x + 1] ? 1n : 0n);
  }
  return { hash, thumb: resample(f.rgb, f.w, 3, x0, y0, x1, y1, 16, 16) };
}

async function analyse(t) {
  const file = path.join(RAW_DIR, t.file);
  const bytes = await readFile(file);
  const still = isVideo(t.file) ? await videoFrame(file) : bytes;
  const meta = await sharp(still).metadata();
  const width = meta.width, height = meta.pageHeight ?? meta.height;

  const { data, info } = await sharp(still, { animated: false })
    .flatten({ background: '#fff' })
    .removeAlpha()
    .resize(256, 256, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const box = trimBox(data, info.width, info.height);
  const [w, h] = fit(box.width, box.height, WORK);
  const rgb = resample(data, info.width, 3, box.left, box.top,
    box.left + box.width, box.top + box.height, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];

  const hist = new Float32Array(64);
  for (let i = 0; i < rgb.length; i += 3) hist[(rgb[i] >> 6) * 16 + (rgb[i + 1] >> 6) * 4 + (rgb[i + 2] >> 6)]++;
  for (let i = 0; i < 64; i++) hist[i] /= w * h;

  const f = { w, h, rgb, gray, hist };
  const [nw, nh] = fit(w, h, NCC_SIZE);
  f.ncc = integral(resample(gray, w, 1, 0, 0, w, h, nw, nh), nw, nh);

  return {
    ...t,
    width,
    height,
    area: width * height,
    aspect: box.width / box.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    still: isVideo(t.file) ? still : null,
    features: f,
    ...describe(f),
  };
}

// Grayscale image plus its summed-area tables, so the mean and variance of
// any window are O(1) during the cross-correlation search.
function integral(px, w, h) {
  const s = new Float64Array((w + 1) * (h + 1)), s2 = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = px[y * w + x], i = (y + 1) * (w + 1) + x + 1;
      s[i] = v + s[i - 1] + s[i - w - 1] - s[i - w - 2];
      s2[i] = v * v + s2[i - 1] + s2[i - w - 1] - s2[i - w - 2];
    }
  }
  return { px, w, h, s, s2 };
}

// Best normalized cross-correlation of all of `a`, scaled to cover between
// MIN_CROP_AREA and 100% of `b`, at any position inside `b`.
// Returns the matched region in b's feature coordinates.
function findInside(a, b) {
  const B = b.ncc, W = B.w, H = B.h, row = W + 1;
  const sum = (t, x, y, w, h) => t[(y + h) * row + x + w] - t[y * row + x + w] - t[(y + h) * row + x] + t[y * row + x];
  const ratio = a.w / a.h;
  let best = { score: -1 };
  for (let scale = 1; scale >= Math.sqrt(MIN_CROP_AREA) - 1e-9; scale -= 0.04) {
    let tw = Math.round(scale * W), th = Math.round(tw / ratio);
    if (th > H) [th, tw] = [Math.round(scale * H), Math.round(scale * H * ratio)];
    if (tw < 6 || th < 6 || tw > W || th > H || tw * th < MIN_CROP_AREA * W * H) continue;

    const t = resample(a.gray, a.w, 1, 0, 0, a.w, a.h, tw, th);
    const n = tw * th;
    let mean = 0;
    for (const v of t) mean += v;
    mean /= n;
    let norm = 0;
    for (let i = 0; i < n; i++) norm += (t[i] -= mean) ** 2;
    if (norm < n * 25) return best; // flat image (std < 5): correlation is meaningless

    for (let oy = 0; oy + th <= H; oy++) {
      for (let ox = 0; ox + tw <= W; ox++) {
        const s = sum(B.s, ox, oy, tw, th);
        const variance = sum(B.s2, ox, oy, tw, th) - (s * s) / n;
        if (variance < n * 25) continue;
        let dot = 0;
        for (let y = 0; y < th; y++) {
          const r = (oy + y) * W + ox, q = y * tw;
          for (let x = 0; x < tw; x++) dot += t[q + x] * B.px[r + x];
        }
        const score = dot / Math.sqrt(norm * variance);
        if (score > best.score) {
          const k = b.w / W;
          best = { score, x0: ox * k, y0: oy * k, x1: (ox + tw) * k, y1: (oy + th) * k, area: n / (W * H) };
        }
      }
    }
  }
  return best;
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

const histOverlap = (a, b) => {
  let s = 0;
  for (let i = 0; i < 64; i++) s += Math.min(a[i], b[i]);
  return s;
};

function sameImage(a, b) {
  if (a.sha256 === b.sha256) return 'identical';
  const same = popcount(a.hash ^ b.hash) <= THRESHOLD &&
    colorDistance(a.thumb, b.thumb) <= MAX_COLOR_DISTANCE &&
    Math.abs(a.aspect - b.aspect) / a.aspect < 0.08;
  return same ? 'same' : null;
}

// Whether the matched region looks like some of b's panels rather than a
// crop of its picture (e.g. a 3-panel vs a 4-panel version of a meme, or one
// half of a before/after template): it is flush with three of b's sides, so
// everything b has in addition sits on one side, past a panel border.
// Panels are mostly stacked vertically, where whole rows of panels make up as
// much as 75% of the image; real crops flush with three sides cover more.
// Side by side, a genuine crop that keeps the full height is common (a wide
// shot vs a square one), so only a half or less counts there.
function panelSubset(f, { x0, y0, x1, y1, area }) {
  const e = 4; // alignment precision, in feature pixels
  const [l, t, r, b] = [x0 < e, y0 < e, x1 > f.w - e, y1 > f.h - e];
  if (l && r && t !== b) return area <= MAX_PANEL_ROWS_AREA;
  if (t && b && l !== r) return area <= MAX_PANEL_COLUMNS_AREA;
  return false;
}

// Whether `a` is a crop of `b`, checked on the region the correlation aligned.
function cropOf(a, b) {
  const m = findInside(a.features, b.features);
  if (m.score < MIN_NCC || panelSubset(b.features, m)) return null;
  const region = describe(b.features, m.x0, m.y0, m.x1, m.y1);
  const ok = popcount(a.hash ^ region.hash) <= CROP_THRESHOLD &&
    colorDistance(a.thumb, region.thumb) <= CROP_MAX_COLOR_DISTANCE;
  return ok ? `crop (${Math.round(m.area * 100)}% of ${b.name}, ncc ${m.score.toFixed(2)})` : null;
}

const slugify = (s) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'template';

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

async function main() {
  const index = JSON.parse(await readFile(path.join(RAW_DIR, 'index.json'), 'utf8'))
    .filter((t) => t.file && !t.error);
  const manual = JSON.parse(await readFile(MANUAL_FILE, 'utf8'));
  const known = new Set(index.map((t) => t.id));
  for (const { ids } of [...manual.same, ...manual.different]) {
    for (const id of ids) if (!known.has(id)) console.warn(`${path.basename(MANUAL_FILE)}: unknown imgflip id ${id}`);
  }
  // Pairs listed together under "different" are never matched automatically.
  const pairKey = (a, b) => (a < b ? `${a} ${b}` : `${b} ${a}`);
  const different = new Set(manual.different.flatMap(({ ids }) =>
    ids.flatMap((a, i) => ids.slice(i + 1).map((b) => pairKey(a, b)))));

  if (EXPLAIN) {
    const [a, b] = await Promise.all(EXPLAIN.map((id) => {
      const t = index.find((x) => x.id === id);
      if (!t) throw new Error(`unknown imgflip id ${id}`);
      return analyse(t);
    }));
    const pct = (x) => `${Math.round(x * 100)}%`;
    console.log(`${a.name} | ${b.name}`);
    console.log(`  same: dHash ${popcount(a.hash ^ b.hash)} bits (≤${THRESHOLD}), colour ${colorDistance(a.thumb, b.thumb).toFixed(1)} (≤${MAX_COLOR_DISTANCE}), aspect ${a.aspect.toFixed(2)} vs ${b.aspect.toFixed(2)}`);
    console.log(`  histogram overlap ${pct(histOverlap(a.features.hist, b.features.hist))} (≥${pct(MIN_HIST_OVERLAP)})`);
    for (const [x, y] of [[a, b], [b, a]]) {
      const m = findInside(x.features, y.features);
      const r = m.score > -1 && describe(y.features, m.x0, m.y0, m.x1, m.y1);
      console.log(`  ${x.name} inside ${y.name}: ncc ${m.score.toFixed(3)} (≥${MIN_NCC}) over ${pct(m.area ?? 0)}` +
        (r ? `, region dHash ${popcount(x.hash ^ r.hash)} bits (≤${CROP_THRESHOLD}), colour ${colorDistance(x.thumb, r.thumb).toFixed(1)} (≤${CROP_MAX_COLOR_DISTANCE})` +
          (panelSubset(y.features, m) ? ', looks like a subset of its panels' : '') : ''));
    }
    const listed = ['same', 'different'].find((k) => manual[k].some(({ ids }) => ids.includes(a.id) && ids.includes(b.id)));
    if (listed) console.log(`  listed as "${listed}" in ${path.basename(MANUAL_FILE)}`);
    console.log(`  → ${sameImage(a, b) ?? cropOf(a, b) ?? cropOf(b, a) ?? 'not duplicates'}`);
    return;
  }

  console.log(`analysing ${index.length} images...`);
  const analysed = [];
  let done = 0;
  await pool(index, 4, async (t, i) => {
    try {
      analysed[i] = await analyse(t);
    } catch (err) {
      console.warn(`\nskip ${t.file}: ${err.message}`);
    }
    if (++done % 50 === 0) process.stdout.write(`\r${done}/${index.length}`);
  });
  const items = analysed.filter(Boolean);
  console.log(`\r${items.length} analysed`);

  // Union-find; `reason` records why each item joined its group.
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j, why) => {
    const [ri, rj] = [find(i), find(j)];
    if (ri === rj) return;
    parent[rj] = ri;
    items[j].reason ??= why;
    items[i].reason ??= why;
  };

  // n≈2k → ~2M pairs: the cheap comparisons run on all of them, the crop
  // search only on pairs whose colours are similar enough.
  const candidates = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (different.has(pairKey(items[i].id, items[j].id))) continue;
      const why = sameImage(items[i], items[j]);
      if (why) union(i, j, `${why} as ${items[i].name}`);
      else if (histOverlap(items[i].features.hist, items[j].features.hist) >= MIN_HIST_OVERLAP) candidates.push([i, j]);
    }
  }
  console.log(`crop search on ${candidates.length} candidate pairs...`);
  for (const [i, j] of candidates) {
    if (find(i) === find(j)) continue;
    const [small, big] = items[i].area <= items[j].area ? [i, j] : [j, i];
    const why = cropOf(items[small], items[big]) ?? cropOf(items[big], items[small]);
    if (why) union(i, j, why);
  }

  const byId = new Map(items.map((it, i) => [it.id, i]));
  for (const { ids, note } of manual.same) {
    const found = ids.filter((id) => byId.has(id));
    for (const id of found.slice(1)) union(byId.get(found[0]), byId.get(id), `manual: ${note}`);
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
    const animated = isVideo(canonical.file);
    const best = members
      .filter((m) => isVideo(m.file) === animated)
      .reduce((m, x) => (x.area > m.area ? x : m));

    let slug = slugify(canonical.name);
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(canonical.name)}-${n}`;
    usedSlugs.add(slug);

    const file = `${slug}${path.extname(best.file)}`;
    await copyFile(path.join(RAW_DIR, best.file), path.join(OUT_DIR, file));
    // Animated templates get a still to show in grids and use as a poster.
    let poster;
    if (best.still) {
      poster = `${slug}.poster.jpg`;
      await sharp(best.still).jpeg({ quality: 90 }).toFile(path.join(OUT_DIR, poster));
    }

    templates.push({
      id: slug,
      name: canonical.name,
      file,
      ...(poster && { poster, animated: true }),
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
  const media = (m) => (isVideo(m.file)
    ? `<video muted loop autoplay playsinline src="raw/imgflip/${esc(m.file)}"></video>`
    : `<img loading="lazy" src="raw/imgflip/${esc(m.file)}">`);
  const rows = groups
    .sort((a, b) => b.members.length - a.members.length || a.keep.rank - b.keep.rank)
    .map((g) => `<section><h2>${esc(g.keep.name)} <small>(${g.members.length})</small></h2><div>${
      g.members.map((m) => `<figure class="${m === g.best ? 'best' : ''}">${media(m)}
        <figcaption>#${m.rank} ${esc(m.name)}<br>${m.width}×${m.height}${isVideo(m.file) ? ' · animated' : ''}
        <br><i>${esc(m.reason ?? '')}</i></figcaption></figure>`).join('')
    }</div></section>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Duplicate groups</title>
<style>
body{font:14px system-ui;margin:24px;background:#111;color:#eee}
section{border-top:1px solid #333;padding:8px 0}
h2{font-size:15px;margin:4px 0}small{color:#888}
section>div{display:flex;gap:12px;flex-wrap:wrap}
figure{margin:0;width:160px}figure :is(img,video){width:160px;height:160px;object-fit:contain;background:#222}
figure.best :is(img,video){outline:3px solid #4ade80}
figcaption{font-size:12px;color:#aaa}figcaption i{color:#777}
</style>
<h1>${groups.length} duplicate groups</h1>
<p>Green outline = file kept (most pixels, animated or not like the most popular member).
Name kept = lowest rank. Italic = why the image joined the group.</p>
${rows}`;
}

main().catch((e) => { console.error(e); process.exit(1); });
