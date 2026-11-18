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
// An animated and a static image are never duplicates: a group mixing them is
// split in two, and the two parts are each other's variants ("animated").
// In each group the most popular template (lowest imgflip rank) keeps its name
// and the file with the most pixels is kept; the other members' files are kept
// too, as the template's `duplicates` (alternative formats).
//
// Templates that are related but not duplicates are recorded as each other's
// `variants` when:
//   - "panels":  one is some of the other's panels (3 vs 4 panels);
//   - "similar": their perceptual hashes are close and their aspect ratios
//                similar, but not close enough to be duplicates (recoloured…);
//   - "name":    the distinctive words of one's name are all in the other's
//                ("Three-headed Dragon" / "4 headed dragon");
//   - "manual":  they are listed together under "variants" in
//                scripts/duplicates.json. Pairs listed under "unrelated" are
//                never variants.
//
// Usage: npm run dedupe -- [--threshold 6]
//        npm run dedupe -- --explain <imgflip id>,<imgflip id>   (why two images do or do not match)

import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify, parseArgs } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import type { Duplicate, Template } from '../client/templates.ts';
import type { RawTemplate } from './imgflip.ts';
import { nameWords, similarNames } from './names.ts';
import {
  type Comparable,
  CROP_MAX_COLOR_DISTANCE,
  CROP_THRESHOLD,
  MAX_COLOR_DISTANCE,
  MIN_HIST_OVERLAP,
  MIN_NCC,
  colorDistance,
  cropOf,
  describe,
  regionOf,
  similarImage,
  extractFeatures,
  findInside,
  histOverlap,
  isRegion,
  panelSubset,
  popcount,
  sameImage,
  slugify,
  trimBox,
} from './features.ts';

const { values: args } = parseArgs({
  options: { threshold: { type: 'string' }, explain: { type: 'string' } },
});
const THRESHOLD = Number(args.threshold ?? 6);
const EXPLAIN = args.explain?.split(',') ?? null;
const RAW_DIR = path.resolve('data/raw/imgflip');
const OUT_DIR = path.resolve('data/templates');
const MANUAL_FILE = path.resolve('scripts/duplicates.json');

interface ManualGroup {
  note: string;
  ids: string[];
}
/** Other names a template is known by, which no imgflip upload of it has. */
interface ManualAliases extends ManualGroup {
  names: string[];
}
interface Manual {
  same: ManualGroup[];
  different: ManualGroup[];
  variants?: ManualGroup[];
  unrelated?: ManualGroup[];
  aliases?: ManualAliases[];
}

type Downloaded = RawTemplate & { file: string };

interface Item extends Downloaded, Comparable {
  width: number;
  height: number;
  area: number;
  /** First frame of an animated template, as PNG. */
  still: Buffer | null;
  /** Why the item joined its group. */
  reason?: string;
}

const execFileAsync = promisify(execFile);
// ffmpeg-static is a CommonJS module exporting the binary's path (null on
// unsupported platforms); fall back to an ffmpeg on the PATH.
function bundledFfmpeg(): string | null {
  try {
    return createRequire(import.meta.url)('ffmpeg-static') as string | null;
  } catch {
    return null;
  }
}
const FFMPEG = process.env.FFMPEG ?? bundledFfmpeg() ?? 'ffmpeg';

const isVideo = (file: string) => path.extname(file).toLowerCase() === '.mp4';

// First frame of a video, as PNG.
async function videoFrame(file: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    FFMPEG,
    ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
    { encoding: 'buffer', maxBuffer: 1 << 28 },
  );
  return stdout;
}

async function analyse(t: Downloaded): Promise<Item> {
  const file = path.join(RAW_DIR, t.file);
  const bytes = await readFile(file);
  const still = isVideo(t.file) ? await videoFrame(file) : bytes;
  const meta = await sharp(still).metadata();
  const width = meta.width;
  const height = meta.pageHeight ?? meta.height;

  const { data, info } = await sharp(still, { animated: false })
    .flatten({ background: '#fff' })
    .removeAlpha()
    .resize(256, 256, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const box = trimBox(data, info.width, info.height);
  const features = extractFeatures(data, info.width, box);

  return {
    ...t,
    width,
    height,
    area: width * height,
    aspect: box.width / box.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    still: isVideo(t.file) ? still : null,
    features,
    ...describe(features),
  };
}

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

function explain(a: Item, b: Item, manual: Manual): void {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  console.log(`${a.name} | ${b.name}`);
  console.log(
    `  same: dHash ${popcount(a.hash ^ b.hash)} bits (≤${THRESHOLD}), colour ${colorDistance(a.thumb, b.thumb).toFixed(1)} (≤${MAX_COLOR_DISTANCE}), aspect ${a.aspect.toFixed(2)} vs ${b.aspect.toFixed(2)}`,
  );
  console.log(
    `  histogram overlap ${pct(histOverlap(a.features.hist, b.features.hist))} (≥${pct(MIN_HIST_OVERLAP)})`,
  );
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    const m = findInside(x.features, y.features);
    let line = `  ${x.name} inside ${y.name}: ncc ${m.score.toFixed(3)} (≥${MIN_NCC}) over ${pct(m.area ?? 0)}`;
    if (isRegion(m)) {
      const r = describe(y.features, m.x0, m.y0, m.x1, m.y1);
      line +=
        `, region dHash ${popcount(x.hash ^ r.hash)} bits (≤${CROP_THRESHOLD}), colour ${colorDistance(x.thumb, r.thumb).toFixed(1)} (≤${CROP_MAX_COLOR_DISTANCE})` +
        (panelSubset(y.features, m) ? ', looks like a subset of its panels' : '');
    }
    console.log(line);
  }
  const listed = (['same', 'different', 'variants', 'unrelated'] as const).find((k) =>
    manual[k]?.some(({ ids }) => ids.includes(a.id) && ids.includes(b.id)),
  );
  if (listed) console.log(`  listed as "${listed}" in ${path.basename(MANUAL_FILE)}`);
  const variant =
    [regionOf(a, b), regionOf(b, a)].find((m) => m?.panels)?.why ??
    similarImage(a, b) ??
    (similarNames(nameWords(a.name), nameWords(b.name)) ? 'name' : null);
  const same = sameImage(a, b, THRESHOLD) ?? cropOf(a, b) ?? cropOf(b, a);
  const split = same && isVideo(a.file) !== isVideo(b.file);
  console.log(
    `  → ${split ? `variant: animated (${same})` : (same ?? (variant ? `variant: ${variant}` : 'not related'))}`,
  );
}

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(path.join(RAW_DIR, 'index.json'), 'utf8')) as RawTemplate[];
  const index = raw.filter((t): t is Downloaded => !!t.file && !t.error);
  const manual = JSON.parse(await readFile(MANUAL_FILE, 'utf8')) as Manual;
  const known = new Set(index.map((t) => t.id));
  manual.variants ??= [];
  manual.unrelated ??= [];
  manual.aliases ??= [];
  for (const { ids } of [
    ...manual.same,
    ...manual.different,
    ...manual.variants,
    ...manual.unrelated,
    ...manual.aliases,
  ]) {
    for (const id of ids) {
      if (!known.has(id)) console.warn(`${path.basename(MANUAL_FILE)}: unknown imgflip id ${id}`);
    }
  }
  // Pairs listed together under "different" are never matched automatically.
  const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);
  const pairs = (groups: ManualGroup[]) =>
    new Set(groups.flatMap(({ ids }) => ids.flatMap((a, i) => ids.slice(i + 1).map((b) => pairKey(a, b)))));
  const different = pairs(manual.different);
  const unrelated = pairs(manual.unrelated);

  if (EXPLAIN) {
    const [a, b] = await Promise.all(
      EXPLAIN.map((id) => {
        const t = index.find((x) => x.id === id);
        if (!t) throw new Error(`unknown imgflip id ${id}`);
        return analyse(t);
      }),
    );
    explain(a, b, manual);
    return;
  }

  console.log(`analysing ${index.length} images...`);
  const analysed: (Item | undefined)[] = [];
  let done = 0;
  await pool(index, 4, async (t, i) => {
    try {
      analysed[i] = await analyse(t);
    } catch (err) {
      console.warn(`\nskip ${t.file}: ${(err as Error).message}`);
    }
    if (++done % 50 === 0) process.stdout.write(`\r${done}/${index.length}`);
  });
  const items = analysed.filter((it) => it !== undefined);
  console.log(`\r${items.length} analysed`);

  // Union-find; `reason` records why each item joined its group.
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number, why: string) => {
    const [ri, rj] = [find(i), find(j)];
    if (ri === rj) return;
    parent[rj] = ri;
    items[j].reason ??= why;
    items[i].reason ??= why;
  };

  // Variants found between items, resolved to groups once those are known.
  const variantPairs: { i: number; j: number; why: string }[] = [];

  // n≈2k → ~2M pairs: the cheap comparisons run on all of them, the crop
  // search only on pairs whose colours are similar enough.
  const candidates: [number, number][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (different.has(pairKey(items[i].id, items[j].id))) continue;
      const why = sameImage(items[i], items[j], THRESHOLD);
      if (why) {
        union(i, j, `${why} as ${items[i].name}`);
        continue;
      }
      const similar = similarImage(items[i], items[j]);
      if (similar) variantPairs.push({ i, j, why: similar });
      if (histOverlap(items[i].features.hist, items[j].features.hist) >= MIN_HIST_OVERLAP) {
        candidates.push([i, j]);
      }
    }
  }
  console.log(`crop search on ${candidates.length} candidate pairs...`);
  for (const [i, j] of candidates) {
    if (find(i) === find(j)) continue;
    const [small, big] = items[i].area <= items[j].area ? [i, j] : [j, i];
    const matches = [regionOf(items[small], items[big]), regionOf(items[big], items[small])];
    const crop = matches.find((m) => m && !m.panels);
    if (crop) union(i, j, crop.why);
    else {
      const panels = matches.find((m) => m?.panels);
      if (panels) variantPairs.push({ i, j, why: panels.why });
    }
  }

  const byId = new Map(items.map((it, i) => [it.id, i]));
  for (const { ids, note } of manual.same) {
    const found = ids.flatMap((id) => byId.get(id) ?? []);
    for (const i of found.slice(1)) union(found[0], i, `manual: ${note}`);
  }

  // An animated and a static image are never the same template, however alike
  // they look: each group is split by animation, keeping the most popular
  // member of each part as its root, and the parts are recorded as variants.
  const roots = items.map((_, i) => find(i));
  const parts = new Map<string, number[]>();
  roots.forEach((root, i) => {
    const key = `${root} ${isVideo(items[i].file)}`;
    parts.set(key, [...(parts.get(key) ?? []), i]);
  });
  const splitPairs: [number, number][] = [];
  const partRoots = new Map<number, number[]>();
  for (const [key, members] of parts) {
    const top = members.reduce((a, b) => (items[b].rank < items[a].rank ? b : a));
    for (const i of members) parent[i] = top;
    const root = Number(key.split(' ')[0]);
    partRoots.set(root, [...(partRoots.get(root) ?? []), top]);
  }
  for (const tops of partRoots.values()) {
    for (const top of tops.slice(1)) {
      splitPairs.push([tops[0], top]);
      items[top].reason = 'animated/static split';
    }
  }

  const groups = new Map<number, Item[]>();
  items.forEach((it, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(it);
    groups.set(root, group);
  });

  // Variants, between groups: the pairs found above, the groups whose names
  // match, and the manual list, less the pairs listed as unrelated.
  const variants = new Map<number, Map<number, string>>();
  const relate = (i: number, j: number, why: string) => {
    const [a, b] = [find(i), find(j)];
    if (a === b || unrelated.has(pairKey(items[i].id, items[j].id))) return;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const map = variants.get(x) ?? new Map<number, string>();
      if (!map.has(y)) map.set(y, why);
      variants.set(x, map);
    }
  };
  for (const { i, j, why } of variantPairs) relate(i, j, why);
  for (const [i, j] of splitPairs) relate(i, j, 'animated');
  // Only the kept names: aliases are often loose descriptions.
  const named = [...groups].map(([root, members]) => ({
    root,
    words: nameWords(members.reduce((a, b) => (b.rank < a.rank ? b : a)).name),
  }));
  for (let x = 0; x < named.length; x++) {
    for (let y = x + 1; y < named.length; y++) {
      if (similarNames(named[x].words, named[y].words)) relate(named[x].root, named[y].root, 'name');
    }
  }
  for (const { ids, note } of manual.variants) {
    const found = ids.flatMap((id) => byId.get(id) ?? []);
    found.forEach((i, n) => found.slice(n + 1).forEach((j) => relate(i, j, `manual: ${note}`)));
  }

  const namesOf = new Map<string, string[]>();
  for (const { ids, names } of manual.aliases) {
    for (const id of ids) namesOf.set(id, [...(namesOf.get(id) ?? []), ...names]);
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const usedSlugs = new Set<string>();
  const templates: Template[] = [];
  const slugOf = new Map<number, string>();
  const rootOf = new Map<string, number>();
  const dupGroups: DuplicateGroup[] = [];
  for (const [root, members] of groups) {
    members.sort((a, b) => a.rank - b.rank);
    const canonical = members[0];
    const best = members.reduce((m, x) => (x.area > m.area ? x : m));

    let slug = slugify(canonical.name);
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(canonical.name)}-${n}`;
    usedSlugs.add(slug);
    slugOf.set(root, slug);
    rootOf.set(slug, root);

    // Every distinct file of the group is kept: the best one as the
    // template's, the others (named after their imgflip id) as its duplicates.
    const seen = new Set([best.sha256]);
    const others = members.filter((m) => !seen.has(m.sha256) && seen.add(m.sha256));
    const [main, ...duplicates] = await Promise.all(
      [best, ...others].map((m) => keep(m, m === best ? slug : `${slug}.${m.id}`)),
    );

    templates.push({
      id: slug,
      ...main,
      name: canonical.name,
      rank: canonical.rank,
      source: { ...main.source, pageUrl: canonical.pageUrl },
      aliases: [
        ...new Set([
          ...members.slice(1).map((m) => m.name),
          ...members.flatMap((m) => namesOf.get(m.id) ?? []),
        ]),
      ].filter((n) => n !== canonical.name),
      ...(duplicates.length && { duplicates }),
    });
    if (members.length > 1) dupGroups.push({ keep: canonical, best, members });
  }

  const rankOf = new Map(templates.map((t) => [t.id, t.rank]));
  const variantRows: VariantRow[] = [];
  for (const t of templates) {
    const related = variants.get(rootOf.get(t.id) ?? -1);
    if (!related?.size) continue;
    const rows = [...related].map(([r, why]) => ({ id: slugOf.get(r) ?? '', why }));
    rows.sort((a, b) => (rankOf.get(a.id) ?? 0) - (rankOf.get(b.id) ?? 0));
    t.variants = rows.map((r) => r.id);
    variantRows.push(
      ...rows.filter((r) => t.rank < (rankOf.get(r.id) ?? 0)).map((r) => ({ a: t.id, b: r.id, why: r.why })),
    );
  }

  templates.sort((a, b) => a.rank - b.rank);
  await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(templates, null, 2));
  await writeFile(path.resolve('data/duplicates.html'), renderReport(dupGroups, variantRows, templates));

  const removed = items.length - templates.length;
  console.log(
    `${items.length} images → ${templates.length} templates (${removed} duplicates in ${dupGroups.length} groups, ${variantRows.length} variant pairs)`,
  );
  console.log(`wrote ${OUT_DIR}/index.json and data/duplicates.html`);
}

// Copies an item's file to OUT_DIR as <stem>.<ext>, with a still of animated
// ones (<stem>.poster.jpg) to show in grids and use as a poster.
async function keep(m: Item, stem: string): Promise<Duplicate> {
  const file = `${stem}${path.extname(m.file)}`;
  await copyFile(path.join(RAW_DIR, m.file), path.join(OUT_DIR, file));
  let poster: string | undefined;
  if (m.still) {
    poster = `${stem}.poster.jpg`;
    await sharp(m.still).jpeg({ quality: 90 }).toFile(path.join(OUT_DIR, poster));
  }
  return {
    name: m.name,
    file,
    ...(poster && { poster, animated: true as const }),
    width: m.width,
    height: m.height,
    rank: m.rank,
    source: { site: 'imgflip', id: m.id, pageUrl: m.pageUrl },
  };
}

interface VariantRow {
  a: string;
  b: string;
  why: string;
}

interface DuplicateGroup {
  keep: Item;
  best: Item;
  members: Item[];
}

function renderReport(groups: DuplicateGroup[], variants: VariantRow[], templates: Template[]): string {
  const esc = (s: string | number) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const media = (m: Item) =>
    isVideo(m.file)
      ? `<video muted loop autoplay playsinline src="raw/imgflip/${esc(m.file)}"></video>`
      : `<img loading="lazy" src="raw/imgflip/${esc(m.file)}">`;
  const rows = groups
    .sort((a, b) => b.members.length - a.members.length || a.keep.rank - b.keep.rank)
    .map(
      (g) =>
        `<section><h2>${esc(g.keep.name)} <small>(${g.members.length})</small></h2><div>${g.members
          .map(
            (m) => `<figure class="${m === g.best ? 'best' : ''}">${media(m)}
        <figcaption>#${m.rank} ${esc(m.name)}<br>${m.width}×${m.height}${isVideo(m.file) ? ' · animated' : ''}
        <br><i>${esc(m.reason ?? '')}</i></figcaption></figure>`,
          )
          .join('')}</div></section>`,
    )
    .join('\n');
  const byId = new Map(templates.map((t) => [t.id, t]));
  const still = (id: string) => {
    const t = byId.get(id);
    return t
      ? `<figure><img loading="lazy" src="templates/${esc(t.poster ?? t.file)}"><figcaption>#${t.rank} ${esc(t.name)}</figcaption></figure>`
      : '';
  };
  const variantRows = variants
    .sort((x, y) => x.why.localeCompare(y.why) || x.a.localeCompare(y.a))
    .map((v) => `<section><h2><i>${esc(v.why)}</i></h2><div>${still(v.a)}${still(v.b)}</div></section>`)
    .join('\n');
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
<p>Green outline = file kept (most pixels). Groups never mix animated and static images.
Name kept = lowest rank. Italic = why the image joined the group.</p>
${rows}
<h1>${variants.length} variant pairs</h1>
<p>Related templates that are not duplicates, shown as each other's variants.
List false matches under <code>unrelated</code> in scripts/duplicates.json.</p>
${variantRows}`;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
