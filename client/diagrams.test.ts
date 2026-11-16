import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import {
  type Diagram,
  DIAGRAMS,
  EDITOR_URL,
  FORMATS,
  RENDER_URL,
  editorUrl,
  pictureUrls,
} from './diagrams.ts';

const diagram: Diagram = {
  id: 'test',
  type: 'Flowchart',
  name: 'Test',
  code: 'flowchart TD\n    A[Café ☕] -->|ok?| B{{"🔥 <b>prod</b> & ~/+=?"}}',
};

// What the editor does with the URL hash (deserializeState in its serde.ts).
function readState(url: string): Record<string, unknown> {
  const [base, hash] = url.split('#');
  assert.equal(base, EDITOR_URL);
  const [serde, data] = hash.split(':');
  assert.equal(serde, 'base64');
  return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('editorUrl', () => {
  it('opens the code in the editor, with the default config', () => {
    const state = readState(editorUrl(diagram));
    assert.equal(state.code, diagram.code);
    assert.deepEqual(JSON.parse(state.mermaid as string), {});
    assert.equal(state.updateDiagram, true);
  });

  it('puts the format in the config', () => {
    const dark = FORMATS.find((f) => f.id === 'dark')!;
    assert.deepEqual(JSON.parse(readState(editorUrl(diagram, dark)).mermaid as string), {
      theme: 'neo-dark',
    });
  });

  it('only uses URL-safe characters', () => {
    for (const d of DIAGRAMS) {
      const hash = editorUrl(d).split('#')[1];
      assert.match(hash, /^base64:[\w-]+$/, d.id);
    }
  });
});

// What mermaid.ink does with a pako link: inflate it, then read the config.
function readPicture(url: string): { path: string; query: URLSearchParams; code: string; config: unknown } {
  const { origin, pathname, searchParams } = new URL(url);
  assert.equal(origin, RENDER_URL);
  const [, path, data] = pathname.split('/');
  assert.match(data, /^pako:[\w-]+$/);
  const state = JSON.parse(inflateSync(Buffer.from(data.slice(5), 'base64url')).toString('utf8')) as {
    code: string;
    mermaid: string;
  };
  return { path, query: searchParams, code: state.code, config: JSON.parse(state.mermaid) };
}

describe('pictureUrls', () => {
  it('render the code as SVG and PNG, in the format and on its background', async () => {
    const dark = FORMATS.find((f) => f.id === 'dark')!;
    const { svg, png } = await pictureUrls(diagram, dark);
    const s = readPicture(svg);
    assert.equal(s.path, 'svg');
    assert.equal(s.code, diagram.code);
    assert.deepEqual(s.config, { theme: 'neo-dark' });
    assert.equal(s.query.get('bgColor'), dark.background);
    const p = readPicture(png);
    assert.equal(p.path, 'img');
    assert.equal(p.code, diagram.code);
    assert.equal(p.query.get('type'), 'png');
  });
});

describe('DIAGRAMS', () => {
  it('have unique ids and names', () => {
    assert.equal(new Set(DIAGRAMS.map((d) => d.id)).size, DIAGRAMS.length);
    assert.equal(new Set(DIAGRAMS.map((d) => d.name)).size, DIAGRAMS.length);
  });

  it('have their code trimmed', () => {
    for (const d of DIAGRAMS) assert.equal(d.code, d.code.trim(), d.id);
  });
});

describe('FORMATS', () => {
  it('start with the default, and have unique ids', () => {
    assert.equal(FORMATS[0].id, 'default');
    assert.deepEqual(FORMATS[0].config, {});
    assert.equal(new Set(FORMATS.map((f) => f.id)).size, FORMATS.length);
  });

  it('have a hex background, as mermaid.ink takes it', () => {
    for (const f of FORMATS) assert.match(f.background, /^[\da-f]{6}$/, f.id);
  });
});
