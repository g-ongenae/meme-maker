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
  /**
   * The other files of the duplicates merged into this template (other crops,
   * framings, resolutions, a still of an animated one…), most popular first.
   */
  duplicates?: Duplicate[];
  /** Ids of related but different templates (3 vs 4 panels, recoloured…), most popular first. */
  variants?: string[];
  /** Set on characters (see characters.ts): the id of the template they were cut out of. */
  cutFrom?: string;
}

/** A duplicate's own file, kept as an alternative format of its template. */
export type Duplicate = Pick<
  Template,
  'name' | 'file' | 'poster' | 'animated' | 'width' | 'height' | 'rank' | 'source'
>;

/** Lower-cases and strips accents, so searches ignore both. */
export const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Splits a search query into folded words. */
export const searchWords = (query: string): string[] => fold(query).split(/\s+/).filter(Boolean);

/** A template or one of its duplicates: something with a file to show. */
export type Media = Pick<Template, 'file' | 'poster'>;

// Files are relative to data/templates/, or in a subdirectory for other
// collections ("characters/advice-dog.png").
const encodePath = (file: string): string => file.split('/').map(encodeURIComponent).join('/');

export const imgUrl = (t: Media): string => `/img/${encodePath(t.file)}`;
// Animated templates are .mp4 files: their thumbnail comes from the poster.
export const thumbUrl = (t: Media): string => `/thumb/${encodePath(t.poster ?? t.file)}`;

/** The picture to draw on: the image itself, or the still of an animated template. */
export const stillUrl = (t: Media & Pick<Template, 'animated'>): string | null =>
  !t.animated ? imgUrl(t) : t.poster ? imgUrl({ file: t.poster }) : null;

/**
 * The meme's page on Know Your Meme, found by searching its name: its pages are
 * named after the meme, not the template, so there's no direct link to it.
 */
export const kymUrl = (name: string): string =>
  `https://knowyourmeme.com/search?${new URLSearchParams({ q: name })}`;

/**
 * imgflip's GIF maker for an animated template, to caption the animation itself.
 * The id is the file's own (its image id in base 36): a template's page URL may be
 * another upload's, the most popular of its duplicates. imgflip redirects a wrong
 * name to the right one.
 */
export const gifMakerUrl = (source: Template['source']): string | null => {
  const name = source.pageUrl.match(/^https:\/\/imgflip\.com\/meme\/(?:\d+\/)?([^/?#]+)$/)?.[1];
  const id = parseInt(source.id, 36);
  return source.site === 'imgflip' && name && id ? `https://imgflip.com/gif-maker/${id}/${name}` : null;
};

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
