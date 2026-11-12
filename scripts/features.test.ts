import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Comparable,
  type Pixels,
  colorDistance,
  cropOf,
  describe as describeRegion,
  extractFeatures,
  fit,
  histOverlap,
  panelSubset,
  popcount,
  regionOf,
  resample,
  sameImage,
  similarImage,
  slugify,
  trimBox,
} from './features.ts';

type Rgb = [number, number, number];

/** A w×h RGB image whose pixel colours come from `color(x, y)`. */
function image(w: number, h: number, color: (x: number, y: number) => Rgb): Uint8Array {
  const px = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(color(x, y), (y * w + x) * 3);
  return px;
}

// A busy, non-repeating pattern, so correlations have something to latch on.
const pattern = (x: number, y: number): Rgb => [
  (x * 7 + y * 3) % 256,
  (Math.sin(x / 5) * Math.cos(y / 7) * 127 + 128) | 0,
  (((x * y) / 4) % 256) | 0,
];

function comparable(name: string, px: Pixels, w: number, h: number): Comparable {
  const box = trimBox(px, w, h);
  const features = extractFeatures(px, w, box);
  return {
    name,
    sha256: name,
    aspect: box.width / box.height,
    features,
    ...describeRegion(features),
  };
}

describe('trimBox', () => {
  it('peels off uniform margins and frame lines', () => {
    const px = image(100, 80, (x, y) => {
      if (x < 10 || x >= 90 || y < 5 || y >= 75) return [255, 255, 255]; // white margin
      if (x === 10 || x === 89 || y === 5 || y === 74) return [0, 0, 0]; // black frame
      return pattern(x, y);
    });
    assert.deepEqual(trimBox(px, 100, 80), { left: 11, top: 6, width: 78, height: 68 });
  });

  it('keeps an image without borders whole', () => {
    assert.deepEqual(trimBox(image(40, 30, pattern), 40, 30), { left: 0, top: 0, width: 40, height: 30 });
  });

  it('keeps a mostly blank image whole', () => {
    const px = image(50, 50, (x, y) => (x > 20 && x < 25 && y > 20 && y < 25 ? [0, 0, 0] : [255, 255, 255]));
    assert.deepEqual(trimBox(px, 50, 50), { left: 0, top: 0, width: 50, height: 50 });
  });
});

describe('resample', () => {
  it('averages the pixels each output pixel covers', () => {
    const src = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]; // 4×4 gray
    assert.deepEqual([...resample(src, 4, 1, 0, 0, 4, 4, 2, 2)], [25, 45, 105, 125]);
  });

  it('can resample a region only', () => {
    const src = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];
    assert.deepEqual([...resample(src, 4, 1, 2, 2, 4, 4, 1, 1)], [125]);
  });
});

describe('fit', () => {
  it('scales the long side to the requested size', () => {
    assert.deepEqual(fit(200, 100, 96), [96, 48]);
    assert.deepEqual(fit(100, 400, 96), [24, 96]);
  });

  it('never goes below 4 pixels', () => {
    assert.deepEqual(fit(1000, 1, 96), [96, 4]);
  });
});

describe('popcount', () => {
  it('counts set bits', () => {
    assert.equal(popcount(0n), 0);
    assert.equal(popcount(0b1011n), 3);
    assert.equal(popcount((1n << 64n) - 1n), 64);
  });
});

describe('colorDistance and histOverlap', () => {
  it('measure identical inputs as identical', () => {
    const a = Float32Array.from({ length: 64 }, () => 1 / 64);
    assert.equal(colorDistance(a, a), 0);
    assert.ok(Math.abs(histOverlap(a, a) - 1) < 1e-6);
  });

  it('measure the mean channel difference', () => {
    assert.equal(colorDistance(Float32Array.of(0, 10), Float32Array.of(20, 30)), 20);
  });
});

describe('panelSubset', () => {
  const f = { w: 96, h: 96 };

  it('flags a match flush with three sides covering a few rows of panels', () => {
    assert.ok(panelSubset(f, { score: 1, x0: 0, y0: 0, x1: 96, y1: 48, area: 0.5 }));
  });

  it('accepts a centred crop', () => {
    assert.ok(!panelSubset(f, { score: 1, x0: 10, y0: 10, x1: 86, y1: 86, area: 0.63 }));
  });

  it('accepts a full-height crop covering most of the width', () => {
    assert.ok(!panelSubset(f, { score: 1, x0: 0, y0: 0, x1: 70, y1: 96, area: 0.73 }));
  });
});

describe('sameImage', () => {
  const px = image(120, 90, pattern);

  it('matches the same picture at another resolution', () => {
    const small = resample(px, 120, 3, 0, 0, 120, 90, 60, 45);
    const a = comparable('a', px, 120, 90);
    const b = comparable('b', small, 60, 45);
    assert.equal(sameImage(a, b, 6), 'same');
  });

  it('matches identical files by hash', () => {
    const a = comparable('a', px, 120, 90);
    assert.equal(sameImage(a, { ...a, name: 'b' }, 6), 'identical');
  });

  it('does not match different pictures', () => {
    const other = image(120, 90, (x, y) => pattern(y * 2, x * 3));
    assert.equal(sameImage(comparable('a', px, 120, 90), comparable('b', other, 120, 90), 6), null);
  });
});

describe('cropOf', () => {
  it('finds a crop inside the full picture', () => {
    const full = image(160, 120, pattern);
    const crop = image(120, 90, (x, y) => pattern(x + 20, y + 15));
    const why = cropOf(comparable('crop', crop, 120, 90), comparable('full', full, 160, 120));
    assert.match(why ?? '', /^crop \(5\d% of full, ncc (0\.9\d|1\.00)\)$/);
  });

  it('does not match unrelated pictures', () => {
    const a = image(120, 90, pattern);
    const b = image(120, 90, (x, y) => pattern(y * 2, x * 3));
    assert.equal(cropOf(comparable('a', a, 120, 90), comparable('b', b, 120, 90)), null);
  });
});

describe('regionOf', () => {
  it('reports a subset of panels as such', () => {
    // Four stacked panels; the first three make up the smaller image.
    const panel = (x: number, y: number): Rgb => pattern(x, y + Math.floor(y / 40) * 57);
    const four = image(120, 160, panel);
    const three = image(120, 120, panel);
    const m = regionOf(comparable('three', three, 120, 120), comparable('four', four, 120, 160));
    assert.equal(m?.panels, true);
    assert.equal(cropOf(comparable('three', three, 120, 120), comparable('four', four, 120, 160)), null);
  });
});

describe('similarImage', () => {
  const px = image(120, 90, pattern);

  it('matches a recoloured copy that is not a duplicate', () => {
    // Same luminance structure, colours tinted: too far apart to be the same image.
    const tinted = image(120, 90, (x, y) => {
      const [r, g, b] = pattern(x, y);
      return [Math.min(255, r + 90), g, Math.max(0, b - 90)];
    });
    const a = comparable('a', px, 120, 90);
    const b = comparable('b', tinted, 120, 90);
    assert.equal(sameImage(a, b, 6), null);
    assert.match(similarImage(a, b) ?? '', /^similar \(dHash \d+ bits, r (0\.9\d|1\.00)\)$/);
  });

  it('does not match different pictures', () => {
    const other = image(120, 90, (x, y) => pattern(y * 2, x * 3));
    assert.equal(similarImage(comparable('a', px, 120, 90), comparable('b', other, 120, 90)), null);
  });
});

describe('slugify', () => {
  it('makes URL-safe slugs', () => {
    assert.equal(slugify('Drake Hotline Bling'), 'drake-hotline-bling');
    assert.equal(slugify('  Pokémon: "Who\'s that?!" '), 'pokemon-who-s-that');
  });

  it('caps the length and never returns an empty slug', () => {
    assert.equal(slugify('a'.repeat(200)).length, 80);
    assert.equal(slugify('???'), 'template');
  });
});
