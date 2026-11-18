// What a template is, for the category filter. Animated templates are GIFs,
// characters cut out of templates are Characters and unlisted templates are
// complete memes; the other categories are curated by id. Diagrams aren't
// templates: they're the Mermaid examples of diagrams.ts.

import type { Template } from './templates.ts';

export const CATEGORIES = {
  gifs: 'GIFs',
  complete: 'Complete',
  background: 'Backgrounds',
  format: 'Formats',
  characters: 'Characters',
  diagrams: 'Diagrams',
} as const;

export type Category = keyof typeof CATEGORIES;

const CURATED: Record<
  Exclude<Category, 'gifs' | 'complete' | 'characters' | 'diagrams'>,
  readonly string[]
> = {
  // Blank pages, plain colours, frames.
  background: [
    'black-background',
    'blank',
    'blank-black',
    'blank-blue-background',
    'blank-colored-background',
    'blank-transparent-square',
    'blank-white-template',
    'blank-yellow-sign',
    'double-long-black-template',
    'empty-red-and-black',
    'free',
    'hypnotize',
    'silent-movie-card',
    'spongebob-time-card-background',
    'x-will-return',
  ],
  // Empty layouts: panels, grids, diagrams, the demotivational poster.
  format: [
    'black-box-meme',
    'blank-bingo',
    'blank-comic-panel-1x2',
    'blank-comic-panel-2x1',
    'blank-comic-panel-2x2',
    'blank-starter-pack',
    'venn-diagram',
    'what-my-friends-think-i-do',
  ],
};

const curated = new Map(
  Object.entries(CURATED).flatMap(([category, ids]) => ids.map((id) => [id, category as Category])),
);

export const categoryOf = (t: Template): Category =>
  t.cutFrom ? 'characters' : t.animated ? 'gifs' : (curated.get(t.id) ?? 'complete');

export const isCategory = (key: string | null): key is Category =>
  key !== null && Object.hasOwn(CATEGORIES, key);
