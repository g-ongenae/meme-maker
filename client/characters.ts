// Characters cut out of templates by scripts/extract-characters.ts, as
// written to data/characters/index.json: transparent PNGs to put over another
// picture.

import type { Template } from './templates.ts';

export interface Character {
  /** Slug, also the file name stem. */
  id: string;
  name: string;
  /** Transparent PNG, in data/characters/. */
  file: string;
  width: number;
  height: number;
  /** Id of the template it was cut out of. */
  template: string;
}

/** Card id of a character: its own id, apart from the templates'. */
export const characterId = (c: Pick<Character, 'id'>): string => `characters/${c.id}`;

/**
 * The characters as templates, to list them with the templates: each takes
 * its source template's rank, source and aliases, and the two link to each
 * other as variants.
 */
export function withCharacters(templates: Template[], characters: Character[]): Template[] {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const cutOut = new Map<string, string[]>();
  const cards = characters.map((c): Template => {
    const id = characterId(c);
    const from = byId.get(c.template);
    if (from) cutOut.set(from.id, [...(cutOut.get(from.id) ?? []), id]);
    return {
      id,
      name: c.name,
      file: `characters/${c.file}`,
      width: c.width,
      height: c.height,
      rank: from?.rank ?? Number.MAX_SAFE_INTEGER,
      source: from?.source ?? { site: '', id: '', pageUrl: '' },
      aliases: from?.aliases ?? [],
      ...(from && { variants: [from.id] }),
      cutFrom: c.template,
    };
  });
  return [
    ...templates.map((t) => {
      const ids = cutOut.get(t.id);
      return ids ? { ...t, variants: [...ids, ...(t.variants ?? [])] } : t;
    }),
    ...cards,
  ];
}
