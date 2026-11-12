import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { type Character, characterId, withCharacters } from './characters.ts';
import type { Template } from './templates.ts';

const template = (overrides: Partial<Template>): Template => ({
  id: 'advice-dog',
  name: 'Advice Dog',
  file: 'advice-dog.jpg',
  width: 500,
  height: 500,
  rank: 42,
  source: { site: 'imgflip', id: '1bij', pageUrl: 'https://imgflip.com/meme/Advice-Dog' },
  aliases: ['Advice Puppy'],
  ...overrides,
});

const dog: Character = {
  id: 'advice-dog',
  name: 'Advice Dog',
  file: 'advice-dog.png',
  width: 300,
  height: 260,
  template: 'advice-dog',
};

describe('withCharacters', () => {
  it('lists characters as templates, after the templates', () => {
    const [, character] = withCharacters([template({})], [dog]);
    assert.deepEqual(character, {
      id: 'characters/advice-dog',
      name: 'Advice Dog',
      file: 'characters/advice-dog.png',
      width: 300,
      height: 260,
      rank: 42,
      source: template({}).source,
      aliases: ['Advice Puppy'],
      variants: ['advice-dog'],
      cutFrom: 'advice-dog',
    });
  });

  it('links each template to the characters cut out of it, first', () => {
    const [t] = withCharacters([template({ variants: ['advice-doge'] })], [dog]);
    assert.deepEqual(t.variants, [characterId(dog), 'advice-doge']);
  });

  it('leaves templates without characters as they are', () => {
    const other = template({ id: 'drake' });
    assert.equal(withCharacters([other], [dog])[0], other);
  });

  it('keeps characters whose template is gone, last', () => {
    const [character] = withCharacters([], [dog]);
    assert.equal(character.rank, Number.MAX_SAFE_INTEGER);
    assert.equal(character.variants, undefined);
    assert.equal(character.cutFrom, 'advice-dog');
  });
});
