import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCategory } from './categories.ts';
import { GO_TO, SHORTCUTS, goToCategory } from './shortcuts.ts';

describe('goToCategory', () => {
  it('goes to a category, or to all templates', () => {
    assert.equal(goToCategory('g'), 'gifs');
    assert.equal(goToCategory('t'), 'complete');
    assert.equal(goToCategory('b'), 'background');
    assert.equal(goToCategory('c'), 'characters');
    assert.equal(goToCategory('d'), 'diagrams');
    assert.equal(goToCategory('f'), 'format');
    assert.equal(goToCategory('a'), null);
  });

  it('goes nowhere for other keys', () => {
    assert.equal(goToCategory('x'), undefined);
    assert.equal(goToCategory('toString'), undefined);
  });

  it('only names categories', () => {
    for (const category of Object.values(GO_TO)) assert.ok(category === null || isCategory(category));
  });
});

describe('SHORTCUTS', () => {
  it('lists every g shortcut', () => {
    const listed = SHORTCUTS.flatMap((g) => g.shortcuts.flatMap((s) => s.keys.map((k) => k.join(' '))));
    for (const key of Object.keys(GO_TO)) assert.ok(listed.includes(`g ${key}`), `g ${key}`);
  });

  it('gives a key one meaning per group', () => {
    for (const group of SHORTCUTS) {
      const keys = group.shortcuts.flatMap((s) => s.keys.map((k) => k.join(' ')));
      assert.deepEqual(keys, [...new Set(keys)], group.title);
    }
  });
});
