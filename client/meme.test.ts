import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Ctx,
  type Frame,
  type Layout,
  type Meme,
  type Placed,
  type TextLayer,
  FILL_DEFAULT,
  IMAGE_DEFAULT,
  LINE_HEIGHT,
  STYLES,
  TEXT_DEFAULT,
  blank,
  clampField,
  createHistory,
  crop,
  decode,
  editHash,
  encode,
  fitText,
  fitWidth,
  fitZoom,
  fontOf,
  frameOf,
  imageBox,
  localKey,
  normalizeAngle,
  paint,
  pan,
  panelRect,
  paintText,
  parseEditHash,
  place,
  resize,
  sizeRange,
  rotationTo,
  snap,
  starter,
  styleKeyOf,
  unplace,
  withCaption,
  wrap,
} from './meme.ts';

const text = (overrides: Partial<TextLayer> = {}): TextLayer => ({ ...TEXT_DEFAULT, ...overrides });
const meme = (overrides: Partial<Meme> = {}): Meme => ({ ...blank(), ...overrides });

// Every character is as wide as half the text's size.
const measure = (s: string): number => s.length / 2;

const close = (a: number, b: number, what = ''): void =>
  assert.ok(Math.abs(a - b) < 1e-9, `${what} ${a} ≠ ${b}`);

/** A frame without space around a 1000 × 500 picture. */
const FRAME: Frame = { width: 1000, height: 500, image: { x: 0, y: 0, width: 1000, height: 500 } };

describe('clampField', () => {
  it('rounds to the step, within the limits', () => {
    assert.equal(clampField('x', 12.345), 12.3);
    assert.equal(clampField('x', -500), -100);
    assert.equal(clampField('size', 7.3), 7.5);
    assert.equal(clampField('size', 99), 50);
    assert.equal(clampField('rotation', 12.6), 13);
    assert.equal(clampField('width', 10), 64);
  });
});

describe('frameOf', () => {
  it('is the picture when there is no space around', () => {
    assert.deepEqual(frameOf(blank(), { width: 600, height: 400 }), {
      width: 600,
      height: 400,
      image: { x: 0, y: 0, width: 600, height: 400 },
    });
  });

  it('adds the space in % of the picture', () => {
    const m = meme({ pad: { top: 25, right: 10, bottom: 5, left: 20 } });
    assert.deepEqual(frameOf(m, { width: 600, height: 400 }), {
      width: 780,
      height: 520,
      image: { x: 120, y: 100, width: 600, height: 400 },
    });
  });

  it('scales to the width asked for, space included', () => {
    const f = frameOf(meme({ width: 300, pad: { top: 50, right: 0, bottom: 0, left: 0 } }), {
      width: 600,
      height: 400,
    });
    assert.deepEqual(f, { width: 300, height: 300, image: { x: 0, y: 100, width: 300, height: 200 } });
  });

  it('keeps huge results within what a canvas can hold', () => {
    const f = frameOf(meme({ pad: { top: 100, right: 0, bottom: 100, left: 0 } }), {
      width: 2000,
      height: 4000,
    });
    assert.equal(f.height, 8000);
    assert.equal(f.width, 1333);
  });
});

describe('place / unplace', () => {
  const frame: Frame = { width: 700, height: 500, image: { x: 100, y: 50, width: 600, height: 400 } };

  it('places a box by its centre, relative to the picture', () => {
    const p = place({ x: 50, y: 25, w: 50, h: 10, rotation: 90 }, frame);
    assert.deepEqual({ ...p, angle: 0 }, { cx: 400, cy: 150, width: 300, height: 40, angle: 0 });
    close(p.angle, Math.PI / 2);
  });

  it('places a box in the space around, outside 0–100', () => {
    assert.equal(place({ x: 50, y: -6.25, w: 50, h: 10, rotation: 0 }, frame).cy, 25);
  });

  it('round-trips', () => {
    const box = { x: 12.5, y: -8, w: 33.3, h: 20, rotation: -45 };
    assert.deepEqual(unplace(place(box, frame), frame), box);
  });
});

describe('normalizeAngle', () => {
  it('brings degrees to (-180, 180]', () => {
    assert.equal(normalizeAngle(190), -170);
    assert.equal(normalizeAngle(-190), 170);
    assert.equal(normalizeAngle(180), 180);
    assert.equal(normalizeAngle(-180), 180);
    assert.equal(normalizeAngle(720), 0);
  });
});

describe('imageBox / fitWidth', () => {
  it('makes an image as high as its width and proportions say', () => {
    const box = imageBox({ ...IMAGE_DEFAULT, w: 20, rotation: 30 }, { width: 400, height: 200 }, FRAME);
    assert.deepEqual(box, { x: 50, y: 50, w: 20, h: 20, rotation: 30 });
  });

  it('fits an image in a share of the picture, by its width or its height', () => {
    const picture = { width: 1000, height: 500 };
    assert.equal(fitWidth({ width: 400, height: 100 }, picture), 40);
    // Limited by its height: 40% of 500 px is 200 px, which makes it 100 px wide.
    assert.equal(fitWidth({ width: 100, height: 200 }, picture), 10);
  });
});

describe('resize', () => {
  const box: Placed = { cx: 100, cy: 100, width: 100, height: 60, angle: 0 };

  it('moves the dragged corner and keeps the opposite one', () => {
    assert.deepEqual(resize(box, [1, 1], { x: 250, y: 190 }), {
      cx: 150,
      cy: 130,
      width: 200,
      height: 120,
      angle: 0,
    });
    assert.deepEqual(resize(box, [-1, -1], { x: 100, y: 100 }), {
      cx: 125,
      cy: 115,
      width: 50,
      height: 30,
      angle: 0,
    });
  });

  it('stops at the minimum, not flipping over', () => {
    const r = resize(box, [1, 1], { x: -500, y: -500 }, { min: { width: 10, height: 10 } });
    assert.deepEqual([r.width, r.height, r.cx, r.cy], [10, 10, 55, 75]);
  });

  it('stops at the maximum', () => {
    const r = resize(box, [1, 1], { x: 5000, y: 5000 }, { max: { width: 300, height: 90 } });
    assert.deepEqual([r.width, r.height, r.cx, r.cy], [300, 90, 200, 115]);
    const kept = resize(
      box,
      [1, 1],
      { x: 5000, y: 5000 },
      { max: { width: 300, height: 90 }, ratio: 100 / 60 },
    );
    close(kept.width, 150);
    close(kept.height, 90);
  });

  it('keeps the opposite corner where the limits of a box stop it', () => {
    // Wide and low: 2% of its width is a lot more than 3% of its height.
    const f = frameOf(meme(), { width: 1000, height: 100 });
    const origin = place({ x: 50, y: 50, w: 4, h: 50, rotation: 0 }, f);
    const left = origin.cx - origin.width / 2;
    const top = origin.cy - origin.height / 2;
    for (const to of [
      { x: -900, y: -900 },
      { x: 9000, y: 9000 },
    ]) {
      const p = place(unplace(resize(origin, [1, 1], to, sizeRange(f, 'text')), f), f);
      close(p.cx - p.width / 2, left, 'left');
      close(p.cy - p.height / 2, top, 'top');
    }
    const image = sizeRange(f, 'image');
    assert.deepEqual([image.min.height, image.max.height], [0, Infinity]);
  });

  it('keeps the proportions when asked', () => {
    const r = resize(box, [1, 1], { x: 250, y: 100 }, { ratio: 100 / 60 });
    close(r.width, 200);
    close(r.height, 120);
  });

  it('works along the axes of a rotated box', () => {
    // A quarter turn: the box's width runs down, and its bottom-right corner is at the bottom left.
    const turned = { ...box, angle: Math.PI / 2 };
    const r = resize(turned, [1, 1], { x: 50, y: 250 });
    close(r.width, 200, 'width');
    close(r.height, 80, 'height');
    // The opposite corner hasn't moved.
    close(r.cx + r.height / 2, 130, 'right');
    close(r.cy - r.width / 2, 50, 'top');
  });
});

describe('panels', () => {
  it('places a panel in the picture, inside the space around', () => {
    const f: Frame = { width: 1000, height: 700, image: { x: 0, y: 200, width: 1000, height: 500 } };
    assert.deepEqual(panelRect({ x: 50, y: 10, w: 50, h: 40 }, f), {
      x: 500,
      y: 250,
      width: 500,
      height: 200,
    });
  });

  const square = { width: 100, height: 100 };
  const at = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it('crops a picture to cover a panel, about its middle', () => {
    // A square picture in a wide panel: all of its width, the middle of its height.
    assert.deepEqual(crop(FILL_DEFAULT, square, at(10, 20, 200, 100)), {
      source: at(0, 25, 100, 50),
      target: at(10, 20, 200, 100),
    });
  });

  it('crops closer with the zoom, about its point, without running past the edges', () => {
    const into = at(0, 0, 100, 100);
    assert.deepEqual(crop({ zoom: 2, x: 25, y: 50 }, square, into).source, at(0, 25, 50, 50));
    assert.deepEqual(crop({ zoom: 2, x: 100, y: 0 }, square, into).source, at(50, 0, 50, 50));
  });

  it('shows more of it further, in the middle of the panel when it no longer covers it', () => {
    const into = at(0, 0, 200, 100);
    assert.deepEqual(crop({ zoom: 0.5, x: 0, y: 0 }, square, into), {
      source: at(0, 0, 100, 100),
      target: at(50, 0, 100, 100),
    });
    assert.deepEqual(crop({ zoom: 0.25, x: 50, y: 50 }, square, into).target, at(75, 25, 50, 50));
    assert.equal(fitZoom(square, into), 0.5);
    assert.equal(fitZoom({ width: 300, height: 100 }, { width: 100, height: 100 }), 0.333);
  });

  it('fits a very wide picture whole', () => {
    const wide = { width: 2000, height: 100 };
    const into = at(0, 0, 100, 100);
    const zoom = fitZoom(wide, into);
    assert.equal(zoom, 0.05);
    assert.deepEqual(crop({ zoom, x: 50, y: 50 }, wide, into).source, at(0, 0, 2000, 100));
  });

  it('pans the picture with the drag, and back from an edge at once', () => {
    const wide = { width: 200, height: 100 };
    // 2 px of the result are 1 px of the picture: dragging down shows more of its top.
    assert.deepEqual(pan(FILL_DEFAULT, square, wide, 0, 20), { x: 50, y: 40 });
    // Not past its edges.
    assert.deepEqual(pan(FILL_DEFAULT, square, wide, 0, 200), { x: 50, y: 25 });
    assert.deepEqual(pan(FILL_DEFAULT, square, wide, 300, 0), { x: 50, y: 50 });
    // From a point beyond the edge, from where the picture is.
    assert.deepEqual(pan({ zoom: 1, x: 50, y: 0 }, square, wide, 0, -20), { x: 50, y: 35 });
  });

  it('pans by a little, close up on a very wide picture', () => {
    // As an arrow key does: 0.5% of the panel.
    const moved = pan({ zoom: 5, x: 50, y: 50 }, { width: 2000, height: 100 }, square, 0.5, 0);
    assert.ok(moved.x < 50, String(moved.x));
  });
});

describe('rotationTo / snap', () => {
  it('points the top of a box at a point', () => {
    const c = { x: 100, y: 100 };
    close(rotationTo(c, { x: 100, y: 0 }), 0);
    close(rotationTo(c, { x: 200, y: 100 }), 90);
    close(rotationTo(c, { x: 100, y: 200 }), 180);
    close(rotationTo(c, { x: 0, y: 100 }), -90);
  });

  it('snaps to a step only when close to it', () => {
    assert.equal(snap(43, 45, 4), 45);
    assert.equal(snap(-2, 45, 4), 0);
    assert.equal(snap(30, 45, 4), 30);
    assert.equal(snap(52, 15, 15), 45);
  });
});

describe('wrap', () => {
  it('breaks between words at the width', () => {
    assert.deepEqual(wrap('one two three four', 4, measure), ['one two', 'three', 'four']);
    assert.deepEqual(wrap('one two three four', 100, measure), ['one two three four']);
  });

  it('keeps line breaks, blank lines included, and drops other spaces', () => {
    assert.deepEqual(wrap('  one   two \n\nthree', 100, measure), ['one two', '', 'three']);
  });

  it('gives a word that is too wide a line of its own', () => {
    assert.deepEqual(wrap('a supercalifragilistic b', 3, measure), ['a', 'supercalifragilistic', 'b']);
  });
});

describe('fitText', () => {
  it('keeps the size when the text fits', () => {
    assert.deepEqual(fitText('hello', { width: 200, height: 50 }, 40, measure), {
      size: 40,
      lines: ['hello'],
    });
  });

  it('wraps before it shrinks', () => {
    const fit = fitText('hello world', { width: 110, height: 100 }, 40, measure);
    assert.deepEqual(fit, { size: 40, lines: ['hello', 'world'] });
  });

  it('shrinks until the lines fit the height and the width', () => {
    const box = { width: 110, height: 50 };
    const { size, lines } = fitText('hello world', box, 40, measure);
    assert.ok(size < 40);
    assert.ok(lines.length * LINE_HEIGHT * size <= box.height);
    assert.ok(lines.every((line) => measure(line) * size <= box.width));
    // Not smaller than it has to be: a step bigger wouldn't fit.
    const bigger = size / 0.94;
    assert.ok(wrap('hello world', box.width / bigger, measure).length * LINE_HEIGHT * bigger > box.height);
  });

  it('gives up at a minimum size, overflowing', () => {
    const { size, lines } = fitText('unbreakable', { width: 10, height: 10 }, 100, measure);
    assert.ok(size >= 12 && size < 13, String(size));
    assert.deepEqual(lines, ['unbreakable']);
  });
});

describe('styles', () => {
  it('names the style a text is in', () => {
    assert.equal(styleKeyOf(TEXT_DEFAULT), 'classic');
    assert.equal(styleKeyOf(text(STYLES.label.style)), 'label');
    assert.equal(styleKeyOf(text({ color: '#ff0000' })), null);
  });

  it('starts with a text at the top and one at the bottom', () => {
    assert.deepEqual(
      starter().map((t) => [t.y, t.valign, t.text]),
      [
        [13, 'top', ''],
        [87, 'bottom', ''],
      ],
    );
  });

  it('builds the CSS font, bold only for fonts that can be', () => {
    assert.match(fontOf({ font: 'arial', bold: true }, 20), /^bold 20px Arial,/);
    assert.match(fontOf({ font: 'arial', bold: false }, 12.3456), /^12.35px Arial,/);
    assert.match(fontOf({ font: 'impact', bold: true }, 20), /^20px 'Meme Impact',/);
  });
});

describe('withCaption', () => {
  it('adds space above the picture, and a plain text in the middle of it', () => {
    const m = withCaption(blank());
    assert.equal(m.pad.top, 25);
    assert.equal(m.texts.length, 3);
    const caption = m.texts[2];
    assert.equal(caption.y, -12.5);
    assert.equal(caption.h, 20);
    assert.equal(styleKeyOf(caption), 'plain');
    // In the middle of the space, in the result.
    const f = frameOf(m, { width: 400, height: 400 });
    assert.equal(place(caption, f).cy, 50);
  });

  it('uses the space that is there already when it is enough', () => {
    const m = withCaption(meme({ pad: { top: 60, right: 0, bottom: 0, left: 0 } }));
    assert.equal(m.pad.top, 60);
    assert.equal(m.texts.at(-1)!.y, -30);
  });
});

/** A context that records what is drawn, and measures like `measure`. */
function recorder(): { ctx: Ctx<string>; calls: string[] } {
  const calls: string[] = [];
  const n = (v: number) => Math.round(v * 100) / 100;
  const ctx: Ctx<string> = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    textAlign: '',
    textBaseline: '',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x, y) => calls.push(`translate ${n(x)} ${n(y)}`),
    rotate: (angle) => calls.push(`rotate ${n(angle)}`),
    scale: (x, y) => calls.push(`scale ${x} ${y}`),
    measureText: (s) => ({ width: (s.length / 2) * parseFloat(ctx.font.replace('bold ', '')) }),
    fillText: (s, x, y) => calls.push(`fill "${s}" ${n(x)} ${n(y)} ${ctx.textAlign} ${ctx.fillStyle}`),
    strokeText: (s, x, y) =>
      calls.push(`stroke "${s}" ${n(x)} ${n(y)} ${ctx.strokeStyle} ${n(ctx.lineWidth)}`),
    clearRect: () => calls.push('clear'),
    fillRect: (x, y, w, h) => calls.push(`fillRect ${x} ${y} ${w} ${h} ${ctx.fillStyle}`),
    drawImage: (image: string, ...at: number[]) => calls.push(`image ${image} ${at.map(n).join(' ')}`),
  };
  return { ctx, calls };
}

describe('paintText', () => {
  const box: Placed = { cx: 500, cy: 250, width: 400, height: 200, angle: 0 };

  it('draws nothing for an empty text', () => {
    const { ctx, calls } = recorder();
    paintText(ctx, text({ text: '  \n ' }), box, 500);
    assert.deepEqual(calls, []);
  });

  it('draws the outlines, then the text, in capitals in the middle of its box', () => {
    const { ctx, calls } = recorder();
    // 10% of 500 px: 50 px text, so 25 px a character: two lines of 3.
    paintText(ctx, text({ text: 'abc def ghi jkl mno pqr' }), box, 500);
    assert.deepEqual(calls, [
      'save',
      'translate 500 250',
      'rotate 0',
      'stroke "ABC DEF GHI JKL" 0 -28.75 #000000 7',
      'stroke "MNO PQR" 0 28.75 #000000 7',
      'fill "ABC DEF GHI JKL" 0 -28.75 center #ffffff',
      'fill "MNO PQR" 0 28.75 center #ffffff',
      'restore',
    ]);
    assert.match(ctx.font, /^50px /);
  });

  it('aligns to the sides of its box, turned with it', () => {
    const { ctx, calls } = recorder();
    paintText(
      ctx,
      text({ text: 'Hi', ...STYLES.plain.style, align: 'left', valign: 'bottom' }),
      { ...box, angle: Math.PI },
      500,
    );
    assert.deepEqual(calls.slice(1, -1), [
      'translate 500 250',
      'rotate 3.14',
      'fill "Hi" -200 71.25 left #000000',
    ]);
  });

  it('shrinks a text that does not fit', () => {
    const { ctx, calls } = recorder();
    paintText(ctx, text({ text: 'a much longer text than fits in there', outlineWidth: 0 }), box, 4000);
    assert.ok(parseFloat(ctx.font) < 400);
    assert.ok(calls.length > 4);
  });
});

describe('paint', () => {
  const pictures = (image: string) =>
    image === 'dog' ? { image: 'DOG', width: 200, height: 100 } : undefined;

  it('draws the picture, the images that are there, then the texts', () => {
    const { ctx, calls } = recorder();
    const m = meme({
      texts: [text({ text: 'x', outlineWidth: 0 })],
      images: [
        { ...IMAGE_DEFAULT, image: 'dog', w: 20, flip: true },
        { ...IMAGE_DEFAULT, image: 'missing' },
      ],
    });
    paint(ctx, m, FRAME, 'BASE', pictures);
    assert.deepEqual(calls, [
      'clear',
      'image BASE 0 0 1000 500',
      'save',
      'translate 500 250',
      'rotate 0',
      'scale -1 1',
      'image DOG -100 -50 200 100',
      'restore',
      'save',
      'translate 500 250',
      'rotate 0',
      'fill "X" 0 0 center #ffffff',
      'restore',
    ]);
  });

  it('draws the pictures in the panels over the picture, under the images', () => {
    const { ctx, calls } = recorder();
    const panels = [
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 50, y: 0, w: 50, h: 100 },
    ];
    const m = meme({
      texts: [],
      images: [{ ...IMAGE_DEFAULT, image: 'dog', w: 20 }],
      fills: [
        { ...FILL_DEFAULT, panel: 1, image: 'dog' },
        { ...FILL_DEFAULT, panel: 0, image: 'missing' },
        { ...FILL_DEFAULT, panel: 2, image: 'dog' },
      ],
    });
    paint(ctx, m, FRAME, 'BASE', pictures, panels);
    assert.deepEqual(calls, [
      'clear',
      'image BASE 0 0 1000 500',
      // A 200 × 100 picture in a 500 × 500 panel: the middle of it.
      'image DOG 50 0 100 100 500 0 500 500',
      'save',
      'translate 500 250',
      'rotate 0',
      'image DOG -100 -50 200 100',
      'restore',
    ]);
  });

  it('fills the space around the picture first', () => {
    const { ctx, calls } = recorder();
    const m = meme({ texts: [], pad: { top: 50, right: 0, bottom: 0, left: 0 }, padColor: '#112233' });
    paint(ctx, m, frameOf(m, { width: 100, height: 100 }), 'BASE', pictures);
    assert.deepEqual(calls, ['clear', 'fillRect 0 0 100 150 #112233', 'image BASE 0 50 100 100']);
  });
});

describe('encode / decode', () => {
  it('leaves a blank meme out', () => {
    assert.equal(encode(blank()).toString(), '');
    assert.deepEqual(decode(new URLSearchParams()), blank());
  });

  it('writes each text and the fields that differ from the default', () => {
    const m = blank();
    m.texts[0].text = 'Top text';
    assert.equal(encode(m).toString(), 't=Top+text&ts=y13_vtop&t=&ts=y87_vbottom');
  });

  it('round-trips every field', () => {
    const m: Meme = {
      texts: [
        {
          text: 'Line one\nline two & more = 100%',
          x: 12.5,
          y: -20,
          w: 40,
          h: 33.3,
          rotation: -45,
          size: 7.5,
          font: 'comic',
          color: '#ff0000',
          outline: '#00ff00',
          outlineWidth: 3,
          align: 'right',
          valign: 'bottom',
          caps: false,
          bold: true,
        },
        text({ text: '' }),
      ],
      images: [
        { image: 'characters/doge', x: 10, y: 90, w: 55.5, rotation: 30, flip: true },
        { ...IMAGE_DEFAULT, image: 'characters/doge' },
      ],
      fills: [],
      pad: { top: 25, right: 1, bottom: 0, left: 100 },
      padColor: '#000000',
      width: 640,
    };
    assert.deepEqual(decode(new URLSearchParams(encode(m).toString())), m);
  });

  it('round-trips the styles', () => {
    for (const [key, { style }] of Object.entries(STYLES)) {
      const m = meme({ texts: [text({ text: key, ...style })] });
      assert.deepEqual(decode(encode(m)), m, key);
    }
  });

  it('tells no text at all from the starter texts', () => {
    const m = meme({ texts: [] });
    assert.equal(encode(m).toString(), 'nt=1');
    assert.deepEqual(decode(encode(m)), m);
  });

  it('leaves uploaded images out', () => {
    const m = meme({ images: [{ ...IMAGE_DEFAULT, image: localKey(1) }] });
    assert.equal(encode(m).toString(), '');
    assert.deepEqual(decode(new URLSearchParams(`i=${localKey(1)}&is=`)).images, []);
  });

  it('ignores invalid values and clamps numbers', () => {
    const m = decode(
      new URLSearchParams(
        't=hi&ts=x999_yabc_s0_fwingdings_czzz_l-3_adiagonal_u2_q5__&p=500-x-3&pc=nope&w=-5',
      ),
    );
    assert.deepEqual(m.texts, [text({ text: 'hi', x: 200, size: 1, outlineWidth: 0 })]);
    assert.deepEqual(m.pad, { top: 0, right: 0, bottom: 0, left: 0 });
    assert.equal(m.padColor, '#ffffff');
    assert.equal(m.width, 0);
    assert.equal(decode(new URLSearchParams('w=99999')).width, 4000);
  });

  it('takes the space around as a whole', () => {
    const pad = (p: string) => decode(new URLSearchParams({ p })).pad;
    assert.deepEqual(pad('500-0-3-20'), { top: 100, right: 0, bottom: 3, left: 20 });
    // A sign is a separator too: the sides after it would each be taken for the next.
    for (const p of ['-1-20-30-40', '1-20-30', '1-20-30-40-50', '1-x-30-40', '1--30-40', '1e1-0-0-0', '']) {
      assert.deepEqual(pad(p), { top: 0, right: 0, bottom: 0, left: 0 }, p);
    }
  });

  it('takes a text without fields, and limits how long and how many they are', () => {
    assert.deepEqual(decode(new URLSearchParams('t=alone')).texts, [text({ text: 'alone' })]);
    assert.equal(decode(new URLSearchParams(`t=${'x'.repeat(5000)}`)).texts[0].text.length, 1000);
    assert.equal(decode(new URLSearchParams('t=a&'.repeat(100))).texts.length, 40);
  });
});

describe('encode / decode of a layout', () => {
  const layout: Layout = {
    panels: [
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 50, y: 0, w: 50, h: 100 },
    ],
    texts: [text({ text: 'Title', y: 10 }), text({ x: 25, w: 40 })],
  };

  it('starts with its texts, and leaves them out', () => {
    const m = blank(layout);
    assert.deepEqual(m.texts, layout.texts);
    assert.notEqual(m.texts[0], layout.texts[0]);
    assert.equal(encode(m, layout).toString(), '');
    assert.deepEqual(decode(new URLSearchParams(), layout), m);
    // Without the layout, they're said.
    assert.match(encode(m).toString(), /^t=Title&/);
  });

  it('round-trips the pictures in the panels', () => {
    const m = blank(layout);
    m.fills = [
      { panel: 1, image: 'drake-hotline-bling', zoom: 2.5, x: 10, y: 99.9 },
      { ...FILL_DEFAULT, image: 'distracted-boyfriend' },
    ];
    const params = encode(m, layout);
    assert.equal(params.toString(), 'g=drake-hotline-bling&gs=n1_z2.5_x10_y99.9&g=distracted-boyfriend&gs=');
    assert.deepEqual(decode(new URLSearchParams(params.toString()), layout), m);
  });

  it('leaves out uploaded pictures, panels that are not there and a second picture for a panel', () => {
    const m = blank(layout);
    m.fills = [{ ...FILL_DEFAULT, image: localKey(1) }];
    assert.equal(encode(m, layout).toString(), '');
    const fills = (query: string, of?: Layout) => decode(new URLSearchParams(query), of).fills;
    assert.deepEqual(fills(`g=${localKey(1)}&gs=`, layout), []);
    assert.deepEqual(fills('g=a&gs=n2&g=b&gs=n-1&g=c&gs=n0.5&g=d&gs=nx', layout), []);
    assert.deepEqual(fills('g=a&gs=n1&g=b&gs=n1_z9', layout), [{ ...FILL_DEFAULT, panel: 1, image: 'a' }]);
    assert.deepEqual(fills('g=a&gs=z0_x-5_y500', layout), [
      { ...FILL_DEFAULT, image: 'a', zoom: 0.01, x: 0, y: 100 },
    ]);
    assert.deepEqual(fills('g=a&gs='), []);
  });
});

describe('edit links', () => {
  it('names the template, and the duplicate file when there is one', () => {
    assert.equal(editHash({ id: 'drake' }), '#edit/drake');
    assert.equal(editHash({ id: 'characters/doge', file: 'a b.jpg' }), '#edit/characters/doge?f=a+b.jpg');
    assert.equal(
      editHash({ id: 'drake', file: 'x.jpg', params: new URLSearchParams('t=hi&ts=y13') }),
      '#edit/drake?f=x.jpg&t=hi&ts=y13',
    );
  });

  it('parses them back, the file apart from the meme', () => {
    const link = parseEditHash('#edit/characters/doge?f=a+b.jpg&t=hi&ts=y13');
    assert.equal(link?.id, 'characters/doge');
    assert.equal(link?.file, 'a b.jpg');
    assert.equal(link?.params.toString(), 't=hi&ts=y13');
    assert.deepEqual(parseEditHash('#edit/drake'), { id: 'drake', params: new URLSearchParams() });
  });

  it('is nothing for other hashes', () => {
    for (const hash of ['', '#drake', '#editor', '#editor?w=3', '#edit/', '#edit/?t=x', '#edit/%E0%A4%A'])
      assert.equal(parseEditHash(hash), null, hash);
  });
});

describe('createHistory', () => {
  it('goes back and forth through the snapshots', () => {
    const h = createHistory('a');
    assert.equal(h.canUndo, false);
    assert.equal(h.undo(), null);
    h.push('b');
    h.push('c');
    assert.equal(h.canUndo, true);
    assert.equal(h.canRedo, false);
    assert.equal(h.undo(), 'b');
    assert.equal(h.undo(), 'a');
    assert.equal(h.undo(), null);
    assert.equal(h.redo(), 'b');
    assert.equal(h.redo(), 'c');
    assert.equal(h.redo(), null);
  });

  it('skips a snapshot that changes nothing', () => {
    const h = createHistory('a');
    h.push('a');
    assert.equal(h.canUndo, false);
  });

  it('forgets what was undone once something else is done', () => {
    const h = createHistory('a');
    h.push('b');
    h.undo();
    h.push('c');
    assert.equal(h.canRedo, false);
    assert.equal(h.undo(), 'a');
  });

  it('keeps a limited number of snapshots', () => {
    const h = createHistory('0', 3);
    for (const s of ['1', '2', '3', '4']) h.push(s);
    assert.equal(h.undo(), '3');
    assert.equal(h.undo(), '2');
    assert.equal(h.undo(), null);
  });
});
