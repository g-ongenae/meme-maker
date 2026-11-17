import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Template,
  SORTS,
  fold,
  imgUrl,
  isSortKey,
  kymUrl,
  match,
  searchKeys,
  searchWords,
  stillUrl,
  thumbUrl,
} from './templates.ts';

const template = (overrides: Partial<Template>): Template => ({
  id: 'drake',
  name: 'Drake Hotline Bling',
  file: 'drake.jpg',
  width: 1200,
  height: 1200,
  rank: 1,
  source: { site: 'imgflip', id: '30b1gx', pageUrl: 'https://imgflip.com/meme/Drake-Hotline-Bling' },
  aliases: [],
  ...overrides,
});

describe('fold', () => {
  it('lower-cases and strips accents', () => {
    assert.equal(fold('Pokémon CAFÉ Ñandú'), 'pokemon cafe nandu');
  });
});

describe('searchWords', () => {
  it('splits on whitespace and drops empty words', () => {
    assert.deepEqual(searchWords('  Drake   HOTLINE '), ['drake', 'hotline']);
    assert.deepEqual(searchWords('   '), []);
  });
});

describe('urls', () => {
  it('encodes file names', () => {
    const t = template({ file: 'a b#c.jpg' });
    assert.equal(imgUrl(t), '/img/a%20b%23c.jpg');
    assert.equal(thumbUrl(t), '/thumb/a%20b%23c.jpg');
  });

  it('keeps the subdirectory of other collections', () => {
    const t = template({ file: 'characters/a b.png' });
    assert.equal(imgUrl(t), '/img/characters/a%20b.png');
    assert.equal(thumbUrl(t), '/thumb/characters/a%20b.png');
  });

  it('uses the poster as the thumbnail of animated templates', () => {
    const t = template({ file: 'x.mp4', poster: 'x.poster.jpg', animated: true });
    assert.equal(imgUrl(t), '/img/x.mp4');
    assert.equal(thumbUrl(t), '/thumb/x.poster.jpg');
  });

  it('draws on the image itself, or on the poster of an animated template', () => {
    assert.equal(stillUrl(template({ file: 'a b.jpg' })), '/img/a%20b.jpg');
    assert.equal(
      stillUrl(template({ file: 'x.mp4', poster: 'x.poster.jpg', animated: true })),
      '/img/x.poster.jpg',
    );
    assert.equal(stillUrl(template({ file: 'x.mp4', animated: true })), null);
  });
});

describe('match', () => {
  const keys = searchKeys(template({ aliases: ['Drakeposting', 'Approving Drake'] }));

  it('matches everything on an empty query', () => {
    assert.deepEqual(match(keys, []), { alias: -1 });
  });

  it('matches when every word is in the name', () => {
    assert.deepEqual(match(keys, searchWords('bling drake')), { alias: -1 });
  });

  it('reports the first alias containing every word', () => {
    assert.deepEqual(match(keys, searchWords('posting')), { alias: 0 });
    assert.deepEqual(match(keys, searchWords('approving drake')), { alias: 1 });
  });

  it('does not mix words from the name and an alias', () => {
    assert.equal(match(keys, searchWords('hotline approving')), null);
  });

  it('ignores accents in the query', () => {
    assert.deepEqual(match(keys, searchWords('DRÂKE')), { alias: -1 });
  });
});

describe('SORTS', () => {
  const a = template({ id: 'a', name: 'banana', rank: 2, width: 100, height: 100 });
  const b = template({ id: 'b', name: 'Apple', rank: 3, width: 500, height: 500 });
  const c = template({ id: 'c', name: 'cherry', rank: 1, width: 100, height: 100 });
  const ids = (key: keyof typeof SORTS) => [a, b, c].sort(SORTS[key]).map((t) => t.id);

  it('sorts by popularity', () => assert.deepEqual(ids('rank'), ['c', 'a', 'b']));
  it('sorts by name, case-insensitively', () => assert.deepEqual(ids('name'), ['b', 'a', 'c']));
  it('sorts by size, then popularity', () => assert.deepEqual(ids('size'), ['b', 'c', 'a']));

  it('validates sort keys', () => {
    assert.ok(isSortKey('name'));
    assert.ok(!isSortKey('toString'));
    assert.ok(!isSortKey(null));
  });
});

describe('kymUrl', () => {
  it('searches Know Your Meme for the name', () => {
    assert.equal(kymUrl('Drake Hotline Bling'), 'https://knowyourmeme.com/search?q=Drake+Hotline+Bling');
    assert.equal(
      kymUrl('Is this a pigeon? & co'),
      'https://knowyourmeme.com/search?q=Is+this+a+pigeon%3F+%26+co',
    );
  });
});
