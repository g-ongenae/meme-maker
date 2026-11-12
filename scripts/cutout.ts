// Cuts the character out of an "advice animal" style template: a subject in
// the middle of a flat or geometric background (sunburst slices, gradients…).
// No I/O here, so it can be tested offline (see extract-characters.ts).
//
// The background is everything reachable from the image's edges through
// smooth colour changes: a flood fill that stays close to the colour of the
// edge pixel it started from (or, for gradients, to a colour drifting along
// with the pixels it takes in), and so stops at the subject's outline.
// Background showing through the subject (between an arm and the body…)
// isn't reachable that way, so large enclosed areas in the background's
// colours go too. Then the thin lines of blended colour left along the
// slices' boundaries are dropped, along with specks, and the edge pixels are
// un-mixed from the background so no halo is left around the subject.

/** An RGB (3 channels) or RGBA (4 channels) image. */
export interface RawImage {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array;
}

export type Edge = 'top' | 'right' | 'bottom' | 'left';

/** A rectangle in source pixels: [left, top, right, bottom], right and bottom excluded. */
export type Rect = [number, number, number, number];

export interface CutoutOptions {
  /** How far the background fill strays from the colour it follows (RGB distance). */
  tolerance?: number;
  /** Largest colour difference between neighbouring background pixels (RGB distance). */
  step?: number;
  /**
   * How fast the colour the fill follows moves towards each pixel it takes
   * (0–1): 0 for flat backgrounds, a little for gradients.
   */
  drift?: number;
  /** Edges the background fill starts from: leave out the ones the subject is cut off by. */
  edges?: Edge[];
  /**
   * Whether areas the fill can't reach but in the background's colours are
   * background too (gaps between limbs, slices only touching a left-out edge).
   */
  holes?: boolean;
  /** Smallest such area, as a fraction of the image. */
  holeArea?: number;
  /**
   * Gaps in the subject's outline up to twice this wide (pixels) are closed,
   * so that the fill doesn't leak inside line art whose inside is the colour
   * of the background.
   */
  close?: number;
  /** Extra starting points of the background fill, as [x, y]. */
  seeds?: [number, number][];
  /**
   * The fill only starts from edge pixels whose colour is on at least this
   * fraction of the edges: not from lines of the subject running into them
   * (line art). 0 for every edge pixel.
   */
  minSeed?: number;
  /** Width of the background's lines to remove whatever their colour (pixels); 0 for blended ones only. */
  lines?: number;
  /** Pieces of the subject smaller than this fraction of the largest one are dropped. */
  minPiece?: number;
  /**
   * Whether to un-mix the outline from the background. Off for line art over
   * a dark background, whose dark outline would fade.
   */
  unmix?: boolean;
  /** Always background. */
  erase?: Rect[];
  /** Always subject (unless erased). */
  keep?: Rect[];
}

export const DEFAULTS = {
  tolerance: 28,
  step: 14,
  drift: 0,
  edges: ['top', 'right', 'bottom', 'left'],
  holes: true,
  holeArea: 0.002,
  close: 0,
  seeds: [],
  minSeed: 0,
  minPiece: 0.02,
  lines: 0,
  unmix: true,
  erase: [],
  keep: [],
} satisfies Required<CutoutOptions>;

const BG = 1;

const inRect = (x: number, y: number, [l, t, r, b]: Rect) => x >= l && x < r && y >= t && y < b;

/** Pixels on the given edges of a width × height image. */
export function edgePixels(width: number, height: number, edges: readonly Edge[]): number[] {
  const out = new Set<number>();
  for (const edge of edges) {
    if (edge === 'top' || edge === 'bottom') {
      const y = edge === 'top' ? 0 : height - 1;
      for (let x = 0; x < width; x++) out.add(y * width + x);
    } else {
      const x = edge === 'left' ? 0 : width - 1;
      for (let y = 0; y < height; y++) out.add(y * width + x);
    }
  }
  return [...out];
}

/**
 * Flood fills `mask` (0 = free, anything else = taken) with BG from `seeds`,
 * through 4-neighbours whose colour is within `step` of their own and within
 * `tolerance` of the colour of the seed they were reached from, or, with
 * some `drift`, of a reference that moves towards each pixel taken (to follow
 * gradients).
 */
function fill(
  img: RawImage,
  mask: Uint8Array,
  seeds: number[],
  { tolerance, step, drift }: { tolerance: number; step: number; drift: number },
): void {
  const { width, height, channels: c, data } = img;
  const ref = new Float32Array(width * height * 3);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const tol2 = tolerance * tolerance;
  const step2 = step * step;
  for (const p of seeds) {
    if (mask[p]) continue;
    mask[p] = BG;
    for (let k = 0; k < 3; k++) ref[p * 3 + k] = data[p * c + k];
    queue[tail++] = p;
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p - x) / width;
    const neighbours = [
      x > 0 ? p - 1 : -1,
      x < width - 1 ? p + 1 : -1,
      y > 0 ? p - width : -1,
      y < height - 1 ? p + width : -1,
    ];
    for (const n of neighbours) {
      if (n < 0 || mask[n]) continue;
      let d = 0;
      let s = 0;
      for (let k = 0; k < 3; k++) {
        const diff = data[n * c + k] - ref[p * 3 + k];
        const own = data[n * c + k] - data[p * c + k];
        d += diff * diff;
        s += own * own;
      }
      if (d > tol2 || s > step2) continue;
      mask[n] = BG;
      for (let k = 0; k < 3; k++)
        ref[n * 3 + k] = ref[p * 3 + k] + (data[n * c + k] - ref[p * 3 + k]) * drift;
      queue[tail++] = n;
    }
  }
}

/**
 * Labels the 8-connected components of the pixels where `mask` equals
 * `value`. Returns each pixel's component (-1 elsewhere) and their sizes.
 */
export function components(
  mask: Uint8Array,
  width: number,
  value: number,
): { labels: Int32Array; sizes: number[]; touchesEdge: boolean[] } {
  const height = mask.length / width;
  const labels = new Int32Array(mask.length).fill(-1);
  const sizes: number[] = [];
  const touchesEdge: boolean[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== value || labels[start] > -1) continue;
    const label = sizes.length;
    let size = 0;
    let edge = false;
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (mask[n] === value && labels[n] < 0) {
            labels[n] = label;
            stack.push(n);
          }
        }
      }
    }
    sizes.push(size);
    touchesEdge.push(edge);
  }
  return { labels, sizes, touchesEdge };
}

function neighbours8(p: number, width: number, height: number): number[] {
  const x = p % width;
  const y = (p - x) / width;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const [nx, ny] = [x + dx, y + dy];
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height) out.push(ny * width + nx);
    }
  return out;
}

/** The pixels that aren't BG in `mask`, grown by `radius` (1 where they are). */
function dilate(mask: Uint8Array, width: number, radius: number): Uint8Array {
  const height = mask.length / width;
  const out = new Uint8Array(mask.length);
  let front: number[] = [];
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] === BG) continue;
    out[p] = 1;
    front.push(p);
  }
  for (let r = 0; r < radius; r++) {
    const next: number[] = [];
    for (const p of front) {
      for (const q of neighbours8(p, width, height)) {
        if (out[q]) continue;
        out[q] = 1;
        next.push(q);
      }
    }
    front = next;
  }
  return out;
}

// The pixels among `pixels` whose colour, on a 16-level grid (and the
// shades next to it), is on at least `fraction` of them.
function commonColours(img: RawImage, pixels: number[], fraction: number): number[] {
  const { channels: c, data } = img;
  const bin = (p: number) => [data[p * c] >> 4, data[p * c + 1] >> 4, data[p * c + 2] >> 4];
  const counts = new Uint32Array(16 ** 3);
  for (const p of pixels) {
    const [r, g, b] = bin(p);
    counts[(r << 8) | (g << 4) | b]++;
  }
  const min = fraction * pixels.length;
  return pixels.filter((p) => {
    const [r, g, b] = bin(p);
    let n = 0;
    for (let dr = -1; dr <= 1; dr++)
      for (let dg = -1; dg <= 1; dg++)
        for (let db = -1; db <= 1; db++) {
          const [nr, ng, nb] = [r + dr, g + dg, b + db];
          if (nr >= 0 && ng >= 0 && nb >= 0 && nr < 16 && ng < 16 && nb < 16)
            n += counts[(nr << 8) | (ng << 4) | nb];
        }
    return n >= min;
  });
}

// Colours of the background, on a 32-level grid widened by one step so
// nearby shades count too.
function palette(img: RawImage, mask: Uint8Array): Uint8Array {
  const { channels: c, data } = img;
  const counts = new Uint32Array(32 ** 3);
  let total = 0;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] !== BG) continue;
    counts[((data[p * c] >> 3) << 10) | ((data[p * c + 1] >> 3) << 5) | (data[p * c + 2] >> 3)]++;
    total++;
  }
  const min = Math.max(2, total * 0.0002);
  const bins = new Uint8Array(32 ** 3);
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < min) continue;
    const r = i >> 10;
    const g = (i >> 5) & 31;
    const b = i & 31;
    for (let dr = -1; dr <= 1; dr++)
      for (let dg = -1; dg <= 1; dg++)
        for (let db = -1; db <= 1; db++) {
          const [nr, ng, nb] = [r + dr, g + dg, b + db];
          if (nr >= 0 && ng >= 0 && nb >= 0 && nr < 32 && ng < 32 && nb < 32)
            bins[(nr << 10) | (ng << 5) | nb] = 1;
        }
  }
  return bins;
}

// Distance from colour p to the segment between colours a and b: how far p
// is from being a blend of the two.
function blendDistance2(d: Uint8Array, c: number, p: number, a: number, b: number): number {
  let ab = 0;
  let ap = 0;
  for (let k = 0; k < 3; k++) {
    const e = d[b * c + k] - d[a * c + k];
    ab += e * e;
    ap += (d[p * c + k] - d[a * c + k]) * e;
  }
  const t = ab ? Math.min(1, Math.max(0, ap / ab)) : 0;
  let out = 0;
  for (let k = 0; k < 3; k++) {
    const diff = d[p * c + k] - (d[a * c + k] + t * (d[b * c + k] - d[a * c + k]));
    out += diff * diff;
  }
  return out;
}

/**
 * Returns the background mask (BG = 1) of `img`, decided on `smooth` (the
 * same image, denoised).
 */
export function backgroundMask(smooth: RawImage, options: CutoutOptions = {}): Uint8Array {
  const o = { ...DEFAULTS, ...options };
  const { width, height, channels: c, data } = smooth;
  const n = width * height;
  const mask = new Uint8Array(n);
  const pinned = new Uint8Array(n); // 1 = always subject, 2 = always background
  for (let p = 0; p < n; p++) {
    const x = p % width;
    const y = (p - x) / width;
    if (o.erase.some((r) => inRect(x, y, r))) pinned[p] = 2;
    else if (o.keep.some((r) => inRect(x, y, r))) pinned[p] = 1;
  }
  const respectPins = () => {
    for (let p = 0; p < n; p++) if (pinned[p]) mask[p] = pinned[p] === 2 ? BG : 0;
  };

  // Pinned subject pixels are walls for the fill.
  const walls = (m: Uint8Array) => {
    for (let p = 0; p < n; p++) if (pinned[p] === 1) m[p] = 2;
  };
  walls(mask);
  const seeds = [
    ...commonColours(smooth, edgePixels(width, height, o.edges), o.minSeed),
    ...o.seeds.map(([x, y]) => y * width + x),
  ];
  fill(smooth, mask, seeds, o);
  for (let p = 0; p < n; p++) if (mask[p] === 2) mask[p] = 0;

  if (o.close > 0) {
    // Fill again with what the first fill left out grown by `close` as
    // walls, which closes the gaps, then give the background back the band
    // grown over it, from the outside only.
    const first = mask.slice();
    const band = dilate(first, width, o.close);
    mask.fill(0);
    for (let p = 0; p < n; p++) if (band[p]) mask[p] = 2;
    walls(mask);
    fill(smooth, mask, seeds, o);
    let front: number[] = [];
    for (let p = 0; p < n; p++) if (mask[p] === BG) front.push(p);
    for (let r = 0; r < o.close && front.length; r++) {
      const next: number[] = [];
      for (const p of front) {
        for (const q of neighbours8(p, width, height)) {
          if (mask[q] !== 2 || first[q] !== BG || pinned[q] === 1) continue;
          mask[q] = BG;
          next.push(q);
        }
      }
      front = next;
    }
    for (let p = 0; p < n; p++) if (mask[p] === 2) mask[p] = 0;
  }

  if (o.holes) {
    const bins = palette(smooth, mask);
    const candidate = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (mask[p] === BG || pinned[p] === 1) continue;
      const bin = ((data[p * c] >> 3) << 10) | ((data[p * c + 1] >> 3) << 5) | (data[p * c + 2] >> 3);
      candidate[p] = bins[bin];
    }
    const { labels, sizes } = components(candidate, width, 1);
    const minArea = o.holeArea * n;
    for (let p = 0; p < n; p++) if (labels[p] > -1 && sizes[labels[p]] >= minArea) mask[p] = BG;
  }
  respectPins();

  // Lines of blended colour along the boundaries between background slices:
  // subject pixels with background on two opposite sides, whose colour is a
  // blend of those two. With `lines`, lines up to that wide go whatever their
  // colour (drawn boundaries, ringing).
  const tol2 = o.tolerance * o.tolerance;
  const reach = Math.max(2, o.lines);
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  const isLine = (p: number, x: number, y: number) =>
    directions.some(([dx, dy]) => {
      for (let r = 1; r <= reach; r++) {
        const ax = x + dx * r;
        const ay = y + dy * r;
        if (ax < 0 || ay < 0 || ax >= width || ay >= height) return false;
        const a = ay * width + ax;
        if (mask[a] !== BG) continue;
        for (let s = 1; s <= reach; s++) {
          const bx = x - dx * s;
          const by = y - dy * s;
          if (bx < 0 || by < 0 || bx >= width || by >= height) return false;
          const b = by * width + bx;
          if (mask[b] !== BG) continue;
          return r + s - 1 <= o.lines || (r <= 2 && s <= 2 && blendDistance2(data, c, p, a, b) < tol2);
        }
        return false;
      }
      return false;
    });
  for (let pass = 0; pass < reach + 1; pass++) {
    const drop: number[] = [];
    for (let p = 0; p < n; p++) {
      const x = p % width;
      if (mask[p] !== BG && pinned[p] !== 1 && isLine(p, x, (p - x) / width)) drop.push(p);
    }
    if (!drop.length) break;
    for (const p of drop) mask[p] = BG;
  }

  // Keep the subject's main pieces: drop specks (and stray text).
  const subject = components(mask, width, 0);
  const largest = Math.max(0, ...subject.sizes);
  for (let p = 0; p < n; p++) {
    const label = subject.labels[p];
    if (label > -1 && subject.sizes[label] < o.minPiece * largest && pinned[p] !== 1) mask[p] = BG;
  }
  // Fill pinholes inside the subject.
  const background = components(mask, width, BG);
  for (let p = 0; p < n; p++) {
    const label = background.labels[p];
    if (
      label > -1 &&
      !background.touchesEdge[label] &&
      background.sizes[label] < 0.0004 * n &&
      pinned[p] !== 2
    )
      mask[p] = 0;
  }
  return mask;
}

/**
 * The subject of `img` over a transparent background, cropped to it, given
 * its background mask. The pixels along its outline are un-mixed from the
 * background behind them: partly transparent, in the subject's own colour.
 */
export function cutout(
  img: RawImage,
  mask: Uint8Array,
  { unmix = DEFAULTS.unmix }: Pick<CutoutOptions, 'unmix'> = {},
): RawImage & { left: number; top: number } {
  const { width, height, channels: c, data } = img;
  const n = width * height;
  const alpha = new Float32Array(n);
  const rgb = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    alpha[p] = mask[p] === BG ? 0 : 1;
    for (let k = 0; k < 3; k++) rgb[p * 3 + k] = data[p * c + k];
  }

  const around = (p: number, want: (q: number) => boolean, radius: number): number[] | null => {
    const x = p % width;
    const y = (p - x) / width;
    const sum = [0, 0, 0];
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (!want(q)) continue;
        for (let k = 0; k < 3; k++) sum[k] += data[q * c + k];
        count++;
      }
    }
    return count ? sum.map((s) => s / count) : null;
  };

  // The colour nearest to p's of the pixels around it: the background next
  // to an edge pixel can be several slices of different colours.
  const closest = (p: number, want: (q: number) => boolean, radius: number): number[] | null => {
    const x = p % width;
    const y = (p - x) / width;
    let best = -1;
    let bestDistance = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (!want(q)) continue;
        let d = 0;
        for (let k = 0; k < 3; k++) d += (data[q * c + k] - data[p * c + k]) ** 2;
        if (d < bestDistance) [best, bestDistance] = [q, d];
      }
    }
    return best < 0 ? null : [0, 1, 2].map((k) => data[best * c + k]);
  };

  // How far each subject pixel is from the background, up to DEEP.
  const EDGE = 3;
  const DEEP = EDGE + 2;
  const depth = new Uint8Array(n).fill(DEEP);
  for (let p = 0; p < n; p++) if (mask[p] === BG) depth[p] = 0;
  for (let d = 1; d < DEEP; d++) {
    for (let p = 0; p < n; p++) {
      if (depth[p] <= d) continue;
      if (around(p, (q) => depth[q] === d - 1, 1)) depth[p] = d;
    }
  }

  // Each edge pixel is a blend of the background next to it and the
  // subject further in (past the blur of upscaled images): project it on the
  // segment between the two.
  for (let p = 0; p < (unmix ? n : 0); p++) {
    if (!depth[p] || depth[p] > EDGE) continue;
    const bg = closest(p, (q) => depth[q] === 0, EDGE + 1);
    const fg = around(p, (q) => depth[q] === DEEP, DEEP + 1);
    if (!bg || !fg) continue;
    let ff = 0;
    let fp = 0;
    for (let k = 0; k < 3; k++) {
      const e = fg[k] - bg[k];
      ff += e * e;
      fp += (data[p * c + k] - bg[k]) * e;
    }
    if (ff < 40 * 40) continue; // too alike to tell apart
    const a = Math.min(1, Math.max(0, fp / ff));
    if (a < 0.1) {
      alpha[p] = 0;
      continue;
    }
    alpha[p] = a;
    for (let k = 0; k < 3; k++) {
      rgb[p * 3 + k] = a < 0.5 ? fg[k] : Math.min(255, Math.max(0, (data[p * c + k] - (1 - a) * bg[k]) / a));
    }
  }

  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let p = 0; p < n; p++) {
    if (!alpha[p]) continue;
    const x = p % width;
    const y = (p - x) / width;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  if (right < 0) return { width: 0, height: 0, channels: 4, data: new Uint8Array(0), left: 0, top: 0 };

  const w = right - left + 1;
  const h = bottom - top + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y + top) * width + x + left;
      const o = (y * w + x) * 4;
      const a = alpha[p];
      for (let k = 0; k < 3; k++) out[o + k] = a ? Math.round(rgb[p * 3 + k]) : 0;
      out[o + 3] = Math.round(a * 255);
    }
  }
  return { width: w, height: h, channels: 4, data: out, left, top };
}
