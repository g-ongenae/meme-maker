// Image features and comparisons used by dedupe.ts. Everything here works on
// raw pixel arrays, with no I/O, so it can be tested on synthetic images.

export const MAX_COLOR_DISTANCE = 18; // mean per-channel difference, 0–255

// Crop detection. A crop must cover at least MIN_CROP_AREA of the larger
// image; matches that look like a subset of its panels are rejected too
// (see panelSubset()).
export const MIN_HIST_OVERLAP = 0.75; // colour histogram intersection, pre-filter
export const MIN_NCC = 0.9;
export const MIN_CROP_AREA = 0.4;
export const CROP_THRESHOLD = 10; // dHash bits, on the aligned region
export const CROP_MAX_COLOR_DISTANCE = 20;
export const VARIANT_THRESHOLD = 12; // dHash bits, see similarImage()
export const MIN_VARIANT_CORRELATION = 0.7;
const MAX_PANEL_ROWS_AREA = 0.8; // see panelSubset()
const MAX_PANEL_COLUMNS_AREA = 0.6;

export const WORK = 96; // long side of the trimmed RGB copy every feature is computed from
const NCC_SIZE = 32;

/** Pixel values, channel-interleaved, row by row. */
export type Pixels = ArrayLike<number>;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Bounding box of the image once uniform borders (white margins, black frame
// lines, letterboxing…) are peeled off, layer by layer. A row or column is a
// border when nearly all its pixels share its first pixel's colour.
export function trimBox(px: Pixels, width: number, height: number): Box {
  const at = (x: number, y: number) => (y * width + x) * 3;
  const uniform = (x0: number, y0: number, dx: number, dy: number, n: number) => {
    const r = at(x0, y0);
    let off = 0;
    for (let i = 0, x = x0, y = y0; i < n; i++, x += dx, y += dy) {
      const p = at(x, y);
      const diff =
        Math.abs(px[p] - px[r]) + Math.abs(px[p + 1] - px[r + 1]) + Math.abs(px[p + 2] - px[r + 2]);
      if (diff > 60 && ++off > n * 0.02) return false;
    }
    return true;
  };
  let left = 0;
  let top = 0;
  let right = width;
  let bottom = height;
  for (let changed = true; changed;) {
    changed = false;
    for (; bottom - top > 2 && uniform(left, top, 1, 0, right - left); changed = true) top++;
    for (; bottom - top > 2 && uniform(left, bottom - 1, 1, 0, right - left); changed = true) bottom--;
    for (; right - left > 2 && uniform(left, top, 0, 1, bottom - top); changed = true) left++;
    for (; right - left > 2 && uniform(right - 1, top, 0, 1, bottom - top); changed = true) right--;
  }
  // A mostly blank image would be trimmed to a sliver: keep it whole instead.
  if ((right - left) * (bottom - top) < width * height * 0.3) return { left: 0, top: 0, width, height };
  return { left, top, width: right - left, height: bottom - top };
}

// Box-filter resample of the rectangle [x0,x1)×[y0,y1) of a w×h image with
// `ch` channels into a dw×dh image.
export function resample(
  src: Pixels,
  w: number,
  ch: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh * ch);
  const h = src.length / (w * ch);
  const sx = (x1 - x0) / dw;
  const sy = (y1 - y0) / dh;
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

/** Dimensions of a w×h image scaled so its long side is `size`. */
export const fit = (w: number, h: number, size: number): [number, number] =>
  w >= h ? [size, Math.max(4, Math.round((size * h) / w))] : [Math.max(4, Math.round((size * w) / h)), size];

/** Grayscale image plus its summed-area tables. */
export interface Integral {
  px: Float32Array;
  w: number;
  h: number;
  s: Float64Array;
  s2: Float64Array;
}

export interface Features {
  w: number;
  h: number;
  rgb: Float32Array;
  gray: Float32Array;
  hist: Float32Array;
  ncc: Integral;
}

export interface Description {
  /** 64-bit dHash. */
  hash: bigint;
  /** 16×16 RGB thumbnail. */
  thumb: Float32Array;
}

// Grayscale image plus its summed-area tables, so the mean and variance of
// any window are O(1) during the cross-correlation search.
export function integral(px: Float32Array, w: number, h: number): Integral {
  const s = new Float64Array((w + 1) * (h + 1));
  const s2 = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = px[y * w + x];
      const i = (y + 1) * (w + 1) + x + 1;
      s[i] = v + s[i - 1] + s[i - w - 1] - s[i - w - 2];
      s2[i] = v * v + s2[i - 1] + s2[i - w - 1] - s2[i - w - 2];
    }
  }
  return { px, w, h, s, s2 };
}

/**
 * Features of the trimmed `box` of a `width`×`height` RGB image: an RGB copy
 * WORK pixels on its long side, its grayscale, colour histogram and the small
 * grayscale (with summed-area tables) the crop search runs on.
 */
export function extractFeatures(data: Pixels, width: number, box: Box): Features {
  const [w, h] = fit(box.width, box.height, WORK);
  const rgb = resample(data, width, 3, box.left, box.top, box.left + box.width, box.top + box.height, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  }

  const hist = new Float32Array(64);
  for (let i = 0; i < rgb.length; i += 3) {
    hist[(rgb[i] >> 6) * 16 + (rgb[i + 1] >> 6) * 4 + (rgb[i + 2] >> 6)]++;
  }
  for (let i = 0; i < 64; i++) hist[i] /= w * h;

  const [nw, nh] = fit(w, h, NCC_SIZE);
  return { w, h, rgb, gray, hist, ncc: integral(resample(gray, w, 1, 0, 0, w, h, nw, nh), nw, nh) };
}

// dHash and 16×16 colour thumbnail of a region of a features object.
export function describe(f: Features, x0 = 0, y0 = 0, x1 = f.w, y1 = f.h): Description {
  const g = resample(f.gray, f.w, 1, x0, y0, x1, y1, 9, 8);
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) hash = (hash << 1n) | (g[y * 9 + x] > g[y * 9 + x + 1] ? 1n : 0n);
  }
  return { hash, thumb: resample(f.rgb, f.w, 3, x0, y0, x1, y1, 16, 16) };
}

export interface CropMatch {
  score: number;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  area?: number;
}

export type Region = Required<CropMatch>;

// Best normalized cross-correlation of all of `a`, scaled to cover between
// MIN_CROP_AREA and 100% of `b`, at any position inside `b`.
// Returns the matched region in b's feature coordinates.
export function findInside(a: Features, b: Features): CropMatch {
  const B = b.ncc;
  const W = B.w;
  const H = B.h;
  const row = W + 1;
  const sum = (t: Float64Array, x: number, y: number, w: number, h: number) =>
    t[(y + h) * row + x + w] - t[y * row + x + w] - t[(y + h) * row + x] + t[y * row + x];
  const ratio = a.w / a.h;
  let best: CropMatch = { score: -1 };
  for (let scale = 1; scale >= Math.sqrt(MIN_CROP_AREA) - 1e-9; scale -= 0.04) {
    let tw = Math.round(scale * W);
    let th = Math.round(tw / ratio);
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
          const r = (oy + y) * W + ox;
          const q = y * tw;
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

export const isRegion = (m: CropMatch): m is Region => m.score > -1;

export function colorDistance(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

export function popcount(n: bigint): number {
  let c = 0;
  for (; n; n &= n - 1n) c++;
  return c;
}

export function histOverlap(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < 64; i++) s += Math.min(a[i], b[i]);
  return s;
}

// Whether the matched region looks like some of b's panels rather than a
// crop of its picture (e.g. a 3-panel vs a 4-panel version of a meme, or one
// half of a before/after template): it is flush with three of b's sides, so
// everything b has in addition sits on one side, past a panel border.
// Panels are mostly stacked vertically, where whole rows of panels make up as
// much as 75% of the image; real crops flush with three sides cover more.
// Side by side, a genuine crop that keeps the full height is common (a wide
// shot vs a square one), so only a half or less counts there.
export function panelSubset(f: Pick<Features, 'w' | 'h'>, { x0, y0, x1, y1, area }: Region): boolean {
  const e = 4; // alignment precision, in feature pixels
  const [l, t, r, b] = [x0 < e, y0 < e, x1 > f.w - e, y1 > f.h - e];
  if (l && r && t !== b) return area <= MAX_PANEL_ROWS_AREA;
  if (t && b && l !== r) return area <= MAX_PANEL_COLUMNS_AREA;
  return false;
}

export interface Comparable extends Description {
  name: string;
  sha256: string;
  aspect: number;
  features: Features;
}

export function sameImage(a: Comparable, b: Comparable, threshold: number): 'identical' | 'same' | null {
  if (a.sha256 === b.sha256) return 'identical';
  const same =
    popcount(a.hash ^ b.hash) <= threshold &&
    colorDistance(a.thumb, b.thumb) <= MAX_COLOR_DISTANCE &&
    Math.abs(a.aspect - b.aspect) / a.aspect < 0.08;
  return same ? 'same' : null;
}

export interface RegionMatch {
  /** The match is a subset of b's panels rather than a crop: a variant, not a duplicate. */
  panels: boolean;
  why: string;
}

// Whether `a` is found inside `b`, checked on the region the correlation
// aligned: as a crop (a duplicate) or as some of b's panels (a variant, e.g.
// the 3-panel version of a 4-panel meme).
export function regionOf(a: Comparable, b: Comparable): RegionMatch | null {
  const m = findInside(a.features, b.features);
  if (!isRegion(m) || m.score < MIN_NCC) return null;
  const region = describe(b.features, m.x0, m.y0, m.x1, m.y1);
  const ok =
    popcount(a.hash ^ region.hash) <= CROP_THRESHOLD &&
    colorDistance(a.thumb, region.thumb) <= CROP_MAX_COLOR_DISTANCE;
  if (!ok) return null;
  const panels = panelSubset(b.features, m);
  return {
    panels,
    why: `${panels ? 'panels' : 'crop'} (${Math.round(m.area * 100)}% of ${b.name}, ncc ${m.score.toFixed(2)})`,
  };
}

// Whether `a` is a crop of `b`.
export function cropOf(a: Comparable, b: Comparable): string | null {
  const m = regionOf(a, b);
  return m && !m.panels ? m.why : null;
}

// Pearson correlation of two images' grayscale, both resampled to 24×24.
export function correlation(a: Features, b: Features): number {
  const n = 24;
  const x = resample(a.gray, a.w, 1, 0, 0, a.w, a.h, n, n);
  const y = resample(b.gray, b.w, 1, 0, 0, b.w, b.h, n, n);
  const mean = (v: Float32Array) => v.reduce((s, p) => s + p, 0) / v.length;
  const [mx, my] = [mean(x), mean(y)];
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < x.length; i++) {
    xy += (x[i] - mx) * (y[i] - my);
    xx += (x[i] - mx) ** 2;
    yy += (y[i] - my) ** 2;
  }
  // Flat images (std < 5) have no structure to compare.
  return xx < x.length * 25 || yy < y.length * 25 ? 0 : xy / Math.sqrt(xx * yy);
}

// Whether `a` and `b` are variants of one picture that are too different to be
// duplicates: same layout (close perceptual hashes, similar aspect ratios and
// correlated grayscale) but, say, recoloured or with an element changed.
export function similarImage(a: Comparable, b: Comparable): string | null {
  const bits = popcount(a.hash ^ b.hash);
  if (bits > VARIANT_THRESHOLD || Math.abs(a.aspect - b.aspect) / a.aspect >= 0.15) return null;
  const r = correlation(a.features, b.features);
  return r >= MIN_VARIANT_CORRELATION ? `similar (dHash ${bits} bits, r ${r.toFixed(2)})` : null;
}

export const slugify = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'template';
