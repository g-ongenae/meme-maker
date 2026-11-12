// Template data as written by scripts/dedupe.ts to data/templates/index.json,
// and the DOM-free helpers the page uses to search and sort it.

export interface Template {
  /** Slug, also the file name stem. */
  id: string;
  name: string;
  /** Image, or .mp4 for animated templates. */
  file: string;
  /** Still frame of an animated template. */
  poster?: string;
  animated?: true;
  width: number;
  height: number;
  /** Popularity on the source site, 1 = most popular. */
  rank: number;
  source: { site: string; id: string; pageUrl: string };
  /** Names of the duplicates merged into this template. */
  aliases: string[];
}

/** Lower-cases and strips accents, so searches ignore both. */
export const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Splits a search query into folded words. */
export const searchWords = (query: string): string[] => fold(query).split(/\s+/).filter(Boolean);

export const imgUrl = (t: Template): string => `/img/${encodeURIComponent(t.file)}`;
// Animated templates are .mp4 files: their thumbnail comes from the poster.
export const thumbUrl = (t: Template): string => `/thumb/${encodeURIComponent(t.poster ?? t.file)}`;

export const SORTS = {
  rank: (a: Template, b: Template) => a.rank - b.rank,
  name: (a: Template, b: Template) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  size: (a: Template, b: Template) => b.width * b.height - a.width * a.height || a.rank - b.rank,
} satisfies Record<string, (a: Template, b: Template) => number>;

export type SortKey = keyof typeof SORTS;

export const isSortKey = (key: string | null): key is SortKey => key !== null && Object.hasOwn(SORTS, key);

export interface SearchKeys {
  name: string;
  aliases: string[];
}

export const searchKeys = (t: Template): SearchKeys => ({ name: fold(t.name), aliases: t.aliases.map(fold) });

/**
 * Whether a template matches every search word, either in its name or all in
 * one of its aliases. Returns null for no match, `{ alias: -1 }` for a name
 * match, and otherwise the index of the first matching alias.
 */
export function match(keys: SearchKeys, words: string[]): { alias: number } | null {
  if (words.every((w) => keys.name.includes(w))) return { alias: -1 };
  const alias = keys.aliases.findIndex((k) => words.every((w) => k.includes(w)));
  return alias > -1 ? { alias } : null;
}
