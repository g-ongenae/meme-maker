import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { type Diagram, DIAGRAMS, EDITOR_URL, FORMATS, editorUrl } from './diagrams.ts';

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
});
