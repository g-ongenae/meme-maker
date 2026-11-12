import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, decodeEntities, fileFor, parsePage } from './imgflip.ts';

const card = (href: string, name: string, src: string, animated = false) => `
  <div class="mt-box"><h3 class="mt-title"><a class="x" href="${href}">${name}</a></h3>
    <div class="mt-img-wrap"><a href="${href}"><img class="shadow" src="${src}" alt=""/></a></div>
    ${animated ? '<div class="mt-animated-label">animated</div>' : ''}
  </div>`;

describe('parsePage', () => {
  it('reads every template card', () => {
    const html = `<html><body>
      ${card('/meme/Drake-Hotline-Bling', 'Drake Hotline Bling', '//i.imgflip.com/4/30b1gx.jpg')}
      ${card('/meme/Disappearing-kid', 'Disappearing kid', '//i.imgflip.com/2/3ohapu.jpg', true)}
    </body></html>`;
    assert.deepEqual(parsePage(html), [
      {
        id: '30b1gx',
        name: 'Drake Hotline Bling',
        slug: 'Drake-Hotline-Bling',
        pageUrl: 'https://imgflip.com/meme/Drake-Hotline-Bling',
        animated: false,
      },
      {
        id: '3ohapu',
        name: 'Disappearing kid',
        slug: 'Disappearing-kid',
        pageUrl: 'https://imgflip.com/meme/Disappearing-kid',
        animated: true,
      },
    ]);
  });

  it('decodes HTML entities in names', () => {
    const [t] = parsePage(
      card('/meme/x', ' Tom &amp; Jerry &quot;quote&quot; &#039;s ', '//i.imgflip.com/4/abc.jpg'),
    );
    assert.equal(t.name, 'Tom & Jerry "quote" \'s');
  });

  it('skips restricted entries and malformed cards', () => {
    const html =
      card('/meme/Restricted', 'Restricted', '/i-view/abc.jpg') + '<div class="mt-box"><p>no title</p></div>';
    assert.deepEqual(parsePage(html), []);
  });

  it('returns nothing for a page past the last one', () => {
    assert.deepEqual(parsePage('<html><body>No more memes</body></html>'), []);
  });
});

describe('decodeEntities', () => {
  it('does not decode twice', () => {
    assert.equal(decodeEntities('&amp;quot;'), '&quot;');
  });
});

describe('candidates', () => {
  it('only tries the .mp4 of animated templates', () => {
    assert.deepEqual(candidates({ id: 'abc', animated: true }), ['https://i.imgflip.com/abc.mp4']);
  });

  it('tries each image format, then the larger thumbnail', () => {
    assert.deepEqual(candidates({ id: 'abc', animated: false }), [
      'https://i.imgflip.com/abc.jpg',
      'https://i.imgflip.com/abc.png',
      'https://i.imgflip.com/abc.gif',
      'https://i.imgflip.com/2/abc.jpg',
    ]);
  });
});

describe('fileFor', () => {
  it('keeps the extension of originals', () => {
    assert.equal(fileFor('abc', 'https://i.imgflip.com/abc.png'), 'abc.png');
    assert.equal(fileFor('abc', 'https://i.imgflip.com/abc.mp4'), 'abc.mp4');
  });

  it('marks thumbnails', () => {
    assert.equal(fileFor('abc', 'https://i.imgflip.com/2/abc.jpg'), 'abc.thumb.jpg');
  });
});
