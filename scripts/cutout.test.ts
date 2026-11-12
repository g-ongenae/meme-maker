import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type CutoutOptions,
  type RawImage,
  backgroundMask,
  components,
  cutout,
  edgePixels,
} from './cutout.ts';

type Rgb = [number, number, number];

/** A w×h RGB image whose pixel colours come from `color(x, y)`. */
function image(w: number, h: number, color: (x: number, y: number) => Rgb): RawImage {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(color(x, y), (y * w + x) * 3);
  return { width: w, height: h, channels: 3, data };
}

const RED: Rgb = [220, 30, 40];
const YELLOW: Rgb = [250, 230, 20];
const BLUE: Rgb = [30, 60, 220];
const GREEN: Rgb = [40, 200, 60];
const GREY: Rgb = [120, 120, 120];
const BLACK: Rgb = [0, 0, 0];
const mix = (a: Rgb, b: Rgb): Rgb => [0, 1, 2].map((k) => Math.round((a[k] + b[k]) / 2)) as Rgb;

// A 120×120 sunburst of four slices, with blended seams between them.
const S = 120;
const C = S / 2;
function sunburst(x: number, y: number): Rgb {
  const [dx, dy] = [x - C + 0.5, y - C + 0.5];
  const slice = (Math.atan2(dy, dx) + Math.PI) / (Math.PI / 2);
  const colors = [RED, YELLOW, BLUE, GREEN];
  const i = Math.floor(slice) % 4;
  const near = slice - Math.floor(slice);
  const r = Math.hypot(dx, dy);
  // About a pixel either side of each boundary is a blend of the two slices.
  if (near * r * (Math.PI / 2) < 1) return mix(colors[i], colors[(i + 3) % 4]);
  return colors[i];
}

// A grey ring (with background showing through its middle), a black cane
// hanging off it, and a speck.
function subject(x: number, y: number): Rgb | null {
  const r = Math.hypot(x - C + 0.5, y - C + 0.5);
  if (r >= 12 && r < 30) return GREY;
  if (x === C + 35 && y >= C - 5 && y < C + 25) return BLACK;
  if (x >= C + 28 && x < C + 36 && y === C - 5) return BLACK;
  if (x >= 5 && x < 7 && y >= 70 && y < 72) return GREY;
  return null;
}

const scene = (extra: (x: number, y: number) => Rgb | null = () => null) =>
  image(S, S, (x, y) => extra(x, y) ?? subject(x, y) ?? sunburst(x, y));

const at = (mask: Uint8Array, x: number, y: number) => mask[y * S + x];
const subjectPixels = (mask: Uint8Array) => mask.reduce((n, v) => n + (v ? 0 : 1), 0);

describe('edgePixels', () => {
  it('lists the pixels of the chosen edges once', () => {
    assert.deepEqual(
      edgePixels(3, 2, ['top', 'left']).sort((a, b) => a - b),
      [0, 1, 2, 3],
    );
    assert.equal(edgePixels(4, 3, ['top', 'right', 'bottom', 'left']).length, 10);
  });
});

describe('components', () => {
  it('labels 8-connected areas, with their sizes and whether they touch the edge', () => {
    // prettier-ignore
    const mask = new Uint8Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
      0, 0, 0, 0,
    ]);
    const { labels, sizes, touchesEdge } = components(mask, 4, 1);
    assert.deepEqual(sizes, [2, 1]);
    assert.deepEqual(touchesEdge, [true, true]);
    assert.equal(labels[0], labels[5]);
    assert.equal(labels[1], -1);
  });
});

describe('backgroundMask', () => {
  it('keeps the subject and removes the background, its seams, its holes and specks', () => {
    const mask = backgroundMask(scene());
    assert.equal(at(mask, C + 20, C), 0, 'ring');
    assert.equal(at(mask, C + 35, C + 10), 0, 'thin cane');
    assert.equal(at(mask, 5, 5), 1, 'background');
    assert.equal(at(mask, C, C), 1, 'background showing through the ring');
    assert.equal(at(mask, 5, 70), 1, 'speck');
    assert.equal(at(mask, C + 45, C), 1, 'seam between slices');
    const ring = Math.PI * (30 ** 2 - 12 ** 2);
    assert.ok(Math.abs(subjectPixels(mask) - ring) < ring * 0.1, `${subjectPixels(mask)} vs ${ring}`);
  });

  it('can keep enclosed areas', () => {
    assert.equal(at(backgroundMask(scene(), { holes: false }), C, C), 0);
  });

  it('leaves out the edges the subject is cut off by', () => {
    // A grey body running into the bottom edge.
    const img = scene((x, y) => (y >= 90 && x >= 40 && x < 80 ? GREY : null));
    assert.equal(at(backgroundMask(img), C, 110), 1);
    const mask = backgroundMask(img, { edges: ['top', 'left', 'right'] });
    assert.equal(at(mask, C, 110), 0);
    // Slices only touching the bottom edge still go, as enclosed areas.
    assert.equal(at(mask, 20, 115), 1);
  });

  it('removes lines of any colour as wide as `lines`', () => {
    // A 3px black line running into the ring.
    const img = scene((x, y) => (x >= 15 && x < 32 && y >= 40 && y < 43 ? BLACK : null));
    assert.equal(at(backgroundMask(img), 20, 41), 0);
    const mask = backgroundMask(img, { lines: 3 });
    assert.equal(at(mask, 20, 41), 1);
    assert.equal(at(mask, C + 20, C), 0, 'ring');
    assert.equal(at(mask, C + 35, C + 10), 1, 'thin parts of the subject go too');
  });

  it('follows gradients with some drift', () => {
    // A grey square on a left-to-right gradient, filled from the left edge only.
    const img = image(S, S, (x, y) =>
      x >= 50 && x < 70 && y >= 50 && y < 70 ? GREY : [Math.round(x * 2), 40, 200],
    );
    const options: CutoutOptions = { edges: ['left'], holes: false };
    assert.equal(at(backgroundMask(img, options), S - 1, 5), 0);
    const mask = backgroundMask(img, { ...options, drift: 0.2 });
    assert.equal(at(mask, S - 1, 5), 1);
    assert.equal(at(mask, 60, 60), 0);
  });

  it('erases and keeps rectangles', () => {
    const mask = backgroundMask(scene(), { erase: [[C + 30, 0, S, S]], keep: [[0, 0, 4, 4]] });
    assert.equal(at(mask, C + 35, C + 10), 1);
    assert.equal(at(mask, 1, 1), 0);
  });
});

describe('cutout', () => {
  // A white square with a half-blended left column, on red.
  const W: Rgb = [255, 255, 255];
  const R: Rgb = [200, 0, 0];
  const img = image(40, 30, (x, y) =>
    y >= 5 && y < 25 ? (x === 10 ? mix(R, W) : x > 10 && x < 30 ? W : R) : R,
  );
  const mask = Uint8Array.from({ length: 40 * 30 }, (_, p) => {
    const [x, y] = [p % 40, Math.floor(p / 40)];
    return y >= 5 && y < 25 && x >= 10 && x < 30 ? 0 : 1;
  });
  const px = (cut: RawImage, x: number, y: number) => {
    const o = (y * cut.width + x) * 4;
    return [...cut.data.slice(o, o + 4)];
  };

  it('crops to the subject, over a transparent background', () => {
    const cut = cutout(img, mask);
    assert.deepEqual([cut.width, cut.height, cut.left, cut.top, cut.channels], [20, 20, 10, 5, 4]);
    assert.deepEqual(px(cut, 10, 10), [255, 255, 255, 255]);
  });

  it('un-mixes the outline from the background', () => {
    const [r, g, b, a] = px(cutout(img, mask), 0, 10);
    assert.ok(Math.abs(a - 128) < 4, `alpha ${a}`);
    for (const v of [r, g, b]) assert.ok(v > 245, `colour ${[r, g, b]}`);
    assert.equal(px(cutout(img, mask, { unmix: false }), 0, 10)[3], 255);
  });

  it('is empty without a subject', () => {
    assert.equal(cutout(img, new Uint8Array(40 * 30).fill(1)).width, 0);
  });
});
