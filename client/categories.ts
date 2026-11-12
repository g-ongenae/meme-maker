// What a template is, for the category filter. Animated templates are GIFs and
// unlisted ones are complete memes; the other categories are curated by id.

import type { Template } from './templates.ts';

export const CATEGORIES = {
  gifs: 'GIFs',
  complete: 'Complete',
  background: 'Backgrounds',
  format: 'Formats',
  additions: 'Additions',
} as const;

export type Category = keyof typeof CATEGORIES;

const CURATED: Record<Exclude<Category, 'gifs' | 'complete'>, readonly string[]> = {
  // Blank pages, plain colours, frames.
  background: [
    'black-background',
    'black-box-meme',
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
  // Empty layouts: panels, grids, diagrams.
  format: [
    'blank-bingo',
    'blank-comic-panel-1x2',
    'blank-comic-panel-2x1',
    'blank-comic-panel-2x2',
    'blank-starter-pack',
    'venn-diagram',
    'what-my-friends-think-i-do',
  ],
  // Elements to paste onto another template, such as faces.
  additions: [],
};

const curated = new Map(
  Object.entries(CURATED).flatMap(([category, ids]) => ids.map((id) => [id, category as Category])),
);

export const categoryOf = (t: Template): Category =>
  t.animated ? 'gifs' : (curated.get(t.id) ?? 'complete');

export const isCategory = (key: string | null): key is Category =>
  key !== null && Object.hasOwn(CATEGORIES, key);
