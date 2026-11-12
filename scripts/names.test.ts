import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nameWords, similarNames } from './names.ts';

const similar = (a: string, b: string) => similarNames(nameWords(a), nameWords(b));

describe('nameWords', () => {
  it('keeps the distinctive words, folded and singular', () => {
    assert.deepEqual(
      [...nameWords("Galaxy Brain (3 brains) – Pokémon's meme").words],
      ['galaxy', 'brain', 'pokemon'],
    );
  });

  it('flags single-word names', () => {
    assert.ok(nameWords('Squidward!').single);
    assert.ok(!nameWords('Doge 2').single);
  });
});

describe('similarNames', () => {
  it('matches names that differ by a count', () => {
    assert.ok(similar('Three-headed Dragon', '4 headed dragon'));
    assert.ok(similar('Marvel Civil War 1', 'Marvel Civil War 2'));
    assert.ok(similar('Blank Comic Panel 2x2', 'Blank Comic Panel 1x2'));
  });

  it('matches a name contained in a slightly longer one', () => {
    assert.ok(similar('Chuck Norris', 'Chuck Norris Approves'));
    assert.ok(similar('Squidward', 'Squidward window'));
  });

  it('does not match names sharing a single word', () => {
    assert.ok(!similar('Computer Guy', 'Computer Horse'));
    assert.ok(!similar('One please', 'Money Please'));
  });

  it('does not match a name lost in a much longer one', () => {
    assert.ok(!similar('Batman', 'Batman Slapping Robin'));
  });
});
