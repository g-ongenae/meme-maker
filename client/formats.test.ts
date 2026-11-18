import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { categoryOf } from './categories.ts';
import { LAID_OUT, layoutOf } from './formats.ts';
import { MAX_LAYERS, blank, clampField, decode, encode } from './meme.ts';
import type { Template } from './templates.ts';

const template = (id: string): Template => ({
  id,
  name: id,
  file: `${id}.png`,
  width: 100,
  height: 100,
  rank: 1,
  source: { site: 'imgflip', id, pageUrl: '' },
  aliases: [],
});

describe('layouts', () => {
  it('are of formats', () => {
    assert.ok(LAID_OUT.length > 0);
    for (const id of LAID_OUT) assert.equal(categoryOf(template(id)), 'format', id);
  });

  it('have panels inside the picture, apart from one another', () => {
    for (const id of LAID_OUT) {
      const { panels } = layoutOf(id)!;
      assert.ok(panels.length > 0, id);
      for (const [i, p] of panels.entries()) {
        assert.ok(p.x >= 0 && p.y >= 0 && p.w > 0 && p.h > 0, `${id} ${i}`);
        assert.ok(p.x + p.w <= 100.01 && p.y + p.h <= 100.01, `${id} ${i}`);
        for (const q of panels.slice(i + 1)) {
          const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
          assert.ok(apart, `${id} ${i}`);
        }
      }
    }
  });

  it('start with texts within the limits, which links leave out', () => {
    for (const id of LAID_OUT) {
      const layout = layoutOf(id)!;
      assert.ok(layout.texts.length > 0 && layout.texts.length <= MAX_LAYERS, id);
      for (const t of layout.texts) {
        for (const field of ['x', 'y', 'w', 'h', 'size'] as const) {
          assert.equal(clampField(field, t[field]), t[field], `${id} ${field}`);
        }
      }
      const m = blank(layout);
      assert.equal(encode(m, layout).toString(), '', id);
      assert.deepEqual(decode(encode(m, layout), layout), m, id);
    }
  });

  it('has none for other templates', () => {
    assert.equal(layoutOf('drake-hotline-bling'), undefined);
    assert.equal(layoutOf('venn-diagram'), undefined);
  });

  it('has a comic panel 2x2 of four panels, a text at the top of each', () => {
    const { panels, texts } = layoutOf('blank-comic-panel-2x2')!;
    assert.equal(panels.length, 4);
    assert.deepEqual(panels[3], { x: 50.43, y: 50.57, w: 49.14, h: 48.85 });
    assert.equal(texts.length, 4);
    assert.ok(texts.every((t, i) => t.valign === 'top' && t.y < panels[i].y + panels[i].h / 2));
  });
});
