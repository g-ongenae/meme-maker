// The keyboard shortcuts, as listed in the help panel (?). main.ts handles them.

import { type Category, CATEGORIES } from './categories.ts';

/** Keys pressed one after the other, a chord written with "+" (Ctrl+C). */
export type Keys = readonly string[];

export interface Shortcut {
  /** Ways to do it, each a sequence of keys. */
  keys: readonly Keys[];
  does: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: readonly Shortcut[];
}

/** What follows g: the category to go to, null for all templates. */
export const GO_TO: Readonly<Record<string, Category | null>> = {
  a: null,
  g: 'gifs',
  t: 'complete',
  b: 'background',
  c: 'characters',
  d: 'diagrams',
  f: 'format',
};

/** How long g waits for the next key, in ms. */
export const GO_DELAY = 1500;

export const goToCategory = (key: string): Category | null | undefined =>
  Object.hasOwn(GO_TO, key) ? GO_TO[key] : undefined;

const ARROWS = '← ↑ → ↓';

export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: 'Anywhere',
    shortcuts: [
      { keys: [['?']], does: 'Show or hide these shortcuts' },
      { keys: [['.']], does: 'Back to the top' },
      { keys: [['Esc']], does: 'Close' },
    ],
  },
  {
    title: 'Browsing',
    shortcuts: [
      { keys: [['s'], ['/']], does: 'Search the templates' },
      ...Object.entries(GO_TO).map(([key, category]) => ({
        keys: [['g', key]],
        does: `Go to ${category ? CATEGORIES[category] : 'all templates'}`,
      })),
      { keys: [['n']], does: 'Create a background' },
    ],
  },
  {
    title: 'Templates',
    shortcuts: [
      { keys: [[ARROWS]], does: 'Select a template' },
      { keys: [['o'], ['Enter']], does: 'Open it' },
      { keys: [['e']], does: 'Edit it' },
    ],
  },
  {
    title: 'Viewer',
    shortcuts: [
      { keys: [['←'], ['→']], does: 'Previous or next template' },
      { keys: [['a']], does: 'Show or hide the alternatives' },
      { keys: [['e']], does: 'Edit the template' },
      { keys: [['o']], does: 'Open the original' },
      { keys: [['d']], does: 'Download it' },
    ],
  },
  {
    title: 'Meme editor',
    shortcuts: [
      { keys: [['d']], does: 'Download the PNG' },
      { keys: [['Ctrl+C']], does: 'Copy the picture, when no text is selected' },
      { keys: [['s']], does: 'Search the characters' },
      { keys: [['Ctrl+Z']], does: 'Undo' },
      { keys: [['Ctrl+Shift+Z'], ['Ctrl+Y']], does: 'Redo' },
      { keys: [[ARROWS]], does: 'Move the selected text or image (Shift: further)' },
      { keys: [[`Alt+${ARROWS}`]], does: 'Resize it' },
      { keys: [['Delete']], does: 'Remove it' },
      { keys: [['Enter']], does: 'Edit the selected text' },
    ],
  },
  {
    title: 'Background editor',
    shortcuts: [
      { keys: [['d']], does: 'Download the PNG' },
      { keys: [[ARROWS]], does: 'Move the centre, from its handle (Shift: further)' },
    ],
  },
];
