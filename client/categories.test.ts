import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { categoryOf, isCategory } from './categories.ts';
import type { Template } from './templates.ts';

const template = (overrides: Partial<Template>): Template => ({
  id: 'drake-hotline-bling',
  name: 'Drake Hotline Bling',
  file: 'drake-hotline-bling.jpg',
  width: 1200,
  height: 1200,
  rank: 1,
  source: { site: 'imgflip', id: '30b1gx', pageUrl: 'https://imgflip.com/meme/Drake-Hotline-Bling' },
  aliases: [],
  ...overrides,
});

describe('categoryOf', () => {
  it('puts animated templates in gifs', () => {
    assert.equal(categoryOf(template({ id: 'blank', animated: true })), 'gifs');
  });

  it('uses the curated lists', () => {
    assert.equal(categoryOf(template({ id: 'blank-white-template' })), 'background');
    assert.equal(categoryOf(template({ id: 'blank-comic-panel-2x2' })), 'format');
  });

  it('puts characters in characters', () => {
    assert.equal(categoryOf(template({ id: 'characters/advice-dog', cutFrom: 'advice-dog' })), 'characters');
  });

  it('defaults to complete', () => {
    assert.equal(categoryOf(template({})), 'complete');
  });
});

describe('isCategory', () => {
  it('validates category keys', () => {
    assert.ok(isCategory('format'));
    assert.ok(isCategory('characters'));
    assert.ok(!isCategory('additions'));
    assert.ok(!isCategory('toString'));
    assert.ok(!isCategory(null));
  });
});
