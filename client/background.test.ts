import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Background,
  type Ctx,
  DEFAULT,
  PRESETS,
  applyPreset,
  darken,
  decode,
  encode,
  halves,
  imageRect,
  normalizeColor,
  paint,
  reach,
  sliceColors,
  sliceEdges,
} from './background.ts';

const background = (overrides: Partial<Background> = {}): Background => ({ ...DEFAULT, ...overrides });

const TAU = 2 * Math.PI;

describe('normalizeColor', () => {
  it('accepts 3- and 6-digit hex, with or without #', () => {
    assert.equal(normalizeColor('#ABCDEF'), '#abcdef');
    assert.equal(normalizeColor('abcdef'), '#abcdef');
    assert.equal(normalizeColor('f0a'), '#ff00aa');
  });

  it('rejects anything else', () => {
    for (const s of ['', '#abcd', 'red', 'ggg', '#1234567']) assert.equal(normalizeColor(s), null, s);
  });
});

describe('darken', () => {
  it('mixes with black', () => {
    assert.equal(darken('#ff8040', 0), '#ff8040');
    assert.equal(darken('#ff8040', 0.5), '#804020');
    assert.equal(darken('#ffffff', 1), '#000000');
  });
});

describe('sliceEdges', () => {
  it('splits a turn evenly by default, from straight up', () => {
    const edges = sliceEdges(background({ slices: 4 }));
    assert.equal(edges.length, 5);
    edges.forEach((a, i) => assert.ok(Math.abs(a - (-Math.PI / 2 + (i * TAU) / 4)) < 1e-9));
  });

  it('rotates clockwise in degrees', () => {
    assert.ok(Math.abs(sliceEdges(background({ rotation: 90 }))[0]) < 1e-9);
  });

  it('varies widths with the irregularity, the same way for the same seed', () => {
    const b = background({ slices: 10, irregularity: 80, seed: 42 });
    const edges = sliceEdges(b);
    const widths = edges.slice(1).map((a, i) => a - edges[i]);
    assert.ok(Math.abs(edges.at(-1)! - edges[0] - TAU) < 1e-9, 'still a full turn');
    assert.ok(widths.every((w) => w > 0));
    assert.ok(Math.max(...widths) - Math.min(...widths) > 0.1);
    assert.deepEqual(sliceEdges(b), edges);
    assert.notDeepEqual(sliceEdges({ ...b, seed: 43 }), edges);
  });
});

describe('sliceColors', () => {
  it('cycles through the palette', () => {
    assert.deepEqual(sliceColors(['a', 'b'], 4), ['a', 'b', 'a', 'b']);
    assert.deepEqual(sliceColors(['a', 'b', 'c'], 6), ['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('keeps the last slice from merging with the first', () => {
    assert.deepEqual(sliceColors(['a', 'b', 'c'], 7), ['a', 'b', 'c', 'a', 'b', 'c', 'b']);
    assert.deepEqual(sliceColors(['a', 'b', 'c'], 4), ['a', 'b', 'c', 'b']);
  });

  it('cannot help it with two colours and an odd count', () => {
    assert.deepEqual(sliceColors(['a', 'b'], 3), ['a', 'b', 'a']);
  });
});

describe('geometry', () => {
  it('reaches the farthest corner', () => {
    const b = background({ width: 300, height: 400 });
    assert.equal(reach(b, { x: 0, y: 0 }), 500);
    assert.equal(reach(b, { x: 150, y: 200 }), 250);
  });

  it('places the image by its centre and height', () => {
    const b = background({ width: 1000, height: 500, ix: 50, iy: 60, scale: 80 });
    assert.deepEqual(imageRect(b, { width: 200, height: 100 }), { x: 100, y: 100, width: 800, height: 400 });
  });

  it('splits at the centre', () => {
    const b = background({ width: 200, height: 100, cx: 25, cy: 40 });
    assert.deepEqual(halves(b), [
      { x: 0, y: 0, width: 200, height: 40 },
      { x: 0, y: 40, width: 200, height: 60 },
    ]);
    assert.deepEqual(halves({ ...b, split: 'vertical' }), [
      { x: 0, y: 0, width: 50, height: 100 },
      { x: 50, y: 0, width: 150, height: 100 },
    ]);
  });
});

// Records what is drawn: each fill and stroke with its style.
function recorder() {
  const calls: string[] = [];
  const gradient = (kind: string) => {
    const stops: [number, string][] = [];
    return { kind, stops, addColorStop: (offset: number, color: string) => void stops.push([offset, color]) };
  };
  type Recorded = ReturnType<typeof gradient>;
  const style = (s: unknown) =>
    typeof s === 'string'
      ? s
      : `${(s as Recorded).kind}(${(s as Recorded).stops.map((x) => x[1]).join(' ')})`;
  const ctx: Ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    rect: (x, y, w, h) => calls.push(`rect ${x} ${y} ${w} ${h}`),
    clip: () => calls.push('clip'),
    fill: () => calls.push(`fill ${style(ctx.fillStyle)}`),
    stroke: () => calls.push(`stroke ${style(ctx.strokeStyle)} ${ctx.lineWidth}`),
    fillRect: () => calls.push(`fillRect ${style(ctx.fillStyle)}`),
    createRadialGradient: () => gradient('radial'),
    createConicGradient: () => gradient('conic'),
  };
  return { ctx, calls };
}

describe('paint', () => {
  it('fills a solid background with the first colour', () => {
    const { ctx, calls } = recorder();
    paint(ctx, background({ pattern: 'solid', colors: ['#123456', '#ffffff'] }));
    assert.deepEqual(calls, ['save', 'fillRect #123456', 'restore']);
  });

  it('fills each slice, then the lines between them', () => {
    const { ctx, calls } = recorder();
    paint(ctx, background({ colors: ['#000000', '#ffffff'], slices: 4, lineWidth: 5, lineColor: '#ff0000' }));
    assert.deepEqual(calls.slice(1, -1), [
      'fill #000000',
      'fill #ffffff',
      'fill #000000',
      'fill #ffffff',
      'stroke #ff0000 4',
    ]);
  });

  it('shades slices from their colour to darker', () => {
    const { ctx, calls } = recorder();
    paint(ctx, background({ colors: ['#ffffff'], slices: 2, shade: 50 }));
    assert.deepEqual(calls.slice(1, -1), ['fill conic(#ffffff #b3b3b3)', 'fill conic(#ffffff #b3b3b3)']);
  });

  it('draws each half with its own colours', () => {
    const { ctx, calls } = recorder();
    paint(ctx, background({ pattern: 'split', colors: ['#aa0000'], colors2: ['#0000aa'], slices: 2 }));
    assert.deepEqual(calls.slice(1, -1), [
      'save',
      'rect 0 0 800 400',
      'clip',
      'fill #aa0000',
      'fill #aa0000',
      'restore',
      'save',
      'rect 0 400 800 400',
      'clip',
      'fill #0000aa',
      'fill #0000aa',
      'restore',
    ]);
  });

  it('draws a glow through its colours, with every other slice as a ray', () => {
    const { ctx, calls } = recorder();
    paint(
      ctx,
      background({ pattern: 'glow', colors: ['#ffffff', '#ff0000', '#000000'], slices: 6, rays: 50 }),
    );
    assert.deepEqual(calls.slice(1, -1), [
      'fillRect radial(#ffffff #ff0000 #000000)',
      ...Array(3).fill('fill radial(rgb(255 255 255 / 0.5) rgb(255 255 255 / 0))'),
    ]);
  });

  it('darkens the corners last', () => {
    const { ctx, calls } = recorder();
    paint(ctx, background({ pattern: 'solid', vignette: 50 }));
    assert.equal(calls.at(-2), 'fillRect radial(rgb(0 0 0 / 0) rgb(0 0 0 / 0.45))');
  });
});

describe('encode / decode', () => {
  it('leaves defaults out', () => {
    assert.equal(encode(background()).toString(), '');
    assert.deepEqual(decode(new URLSearchParams()), DEFAULT);
  });

  it('round-trips every field', () => {
    const b = background({
      width: 640,
      height: 480,
      pattern: 'split',
      colors: ['#ff0000', '#00ff00'],
      colors2: ['#0000ff'],
      split: 'vertical',
      slices: 9,
      rotation: 45,
      irregularity: 30,
      seed: 1234,
      cx: 33.3,
      cy: 66.7,
      lineWidth: 4,
      lineColor: '#111111',
      shade: 20,
      rays: 70,
      vignette: 10,
      image: 'success-kid',
      ix: 40,
      iy: 70.5,
      scale: 60,
      halo: 25,
    });
    const params = encode(b);
    assert.equal(params.get('c'), 'ff0000-00ff00');
    assert.deepEqual(decode(new URLSearchParams(params.toString())), b);
  });

  it('round-trips the presets', () => {
    for (const [key, { style }] of Object.entries(PRESETS)) {
      const b = applyPreset(background({ width: 500, image: 'x' }), style);
      assert.deepEqual(decode(encode(b)), b, key);
    }
  });

  it('ignores invalid values and clamps numbers', () => {
    const b = decode(
      new URLSearchParams('p=zigzag&d=diagonal&n=1000&r=-5&x=12.345&w=abc&h=&c=zzz-F00-12&lc=nope'),
    );
    assert.equal(b.pattern, DEFAULT.pattern);
    assert.equal(b.split, DEFAULT.split);
    assert.equal(b.slices, 48);
    assert.equal(b.rotation, 0);
    assert.equal(b.cx, 12.3);
    assert.equal(b.width, DEFAULT.width);
    assert.equal(b.height, DEFAULT.height);
    assert.deepEqual(b.colors, ['#ff0000']);
    assert.equal(b.lineColor, DEFAULT.lineColor);
  });

  it('keeps at most 8 colours', () => {
    const b = decode(new URLSearchParams(`c=${Array(12).fill('abc').join('-')}`));
    assert.equal(b.colors.length, 8);
  });
});

describe('applyPreset', () => {
  it('replaces the look but keeps the size and the image', () => {
    const b = background({ width: 300, image: 'doge', scale: 50, lineWidth: 9, pattern: 'glow' });
    const out = applyPreset(b, PRESETS.chicken.style);
    assert.equal(out.width, 300);
    assert.equal(out.image, 'doge');
    assert.equal(out.scale, 50);
    assert.equal(out.lineWidth, 0);
    assert.equal(out.pattern, 'sunburst');
    assert.deepEqual(out.colors, PRESETS.chicken.style.colors);
  });
});
