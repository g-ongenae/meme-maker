// The layouts of the Formats templates (categories.ts) that are made of
// panels: where each panel is, for the meme editor to fill it with a picture
// and give it texts, and the texts a meme of it starts with. The panels were
// measured on the templates' own files: their insides, inside the borders.

import { type Layout, type Panel, type TextLayer, STYLES, TEXT_DEFAULT, clampField } from './meme.ts';

/** A rectangle in px: left, top, width, height. */
type Px = readonly [number, number, number, number];

interface Format {
  /** The template's size, in px, which the panels are measured on. */
  width: number;
  height: number;
  panels: readonly Px[];
  texts(panels: Panel[], at: Sizer): TextLayer[];
}

/** A text's size (see `TextLayer.size`) for a height in px of the template. */
type Sizer = (px: number) => number;

const round = (n: number): number => Math.round(n * 100) / 100;

/** A text in a part of a panel, given in % of the panel. */
function textIn(
  panel: Panel,
  box: { x: number; y: number; w: number; h: number },
  rest: Partial<TextLayer>,
): TextLayer {
  return {
    ...TEXT_DEFAULT,
    x: clampField('x', panel.x + (box.x / 100) * panel.w),
    y: clampField('y', panel.y + (box.y / 100) * panel.h),
    w: clampField('w', (box.w / 100) * panel.w),
    h: clampField('h', (box.h / 100) * panel.h),
    ...rest,
  };
}

/** A whole-picture "panel", for the texts that aren't in one. */
const WHOLE: Panel = { x: 0, y: 0, w: 100, h: 100 };

/** Panels in a grid, from the left and right edges of each column and the top and bottom of each row. */
const grid = (
  columns: readonly (readonly [number, number])[],
  rows: readonly (readonly [number, number])[],
): Px[] =>
  rows.flatMap(([top, bottom]) =>
    columns.map(([left, right]): Px => [left, top, right - left + 1, bottom - top + 1]),
  );

/** Comic panels, with a classic text at the top of each, sized to the panel. */
const comic = (width: number, height: number, panels: Px[]): Format => ({
  width,
  height,
  panels,
  texts: (ps, at) =>
    ps.map((p, i) =>
      textIn(
        p,
        { x: 50, y: 14, w: 94, h: 24 },
        { valign: 'top', size: at(Math.min(panels[i][2], panels[i][3]) * 0.1) },
      ),
    ),
});

const COMIC_COLUMNS = [
  [7, 802],
  [817, 1612],
] as const;
const COMIC_ROWS = [
  [7, 602],
  [617, 1212],
] as const;

const FRIENDS_LABELS = [
  'What my friends think I do',
  'What my mom thinks I do',
  'What society thinks I do',
  'What my boss thinks I do',
  'What I think I do',
  'What I actually do',
];

const FORMATS: Record<string, Format> = {
  'blank-comic-panel-1x2': comic(810, 1220, grid([COMIC_COLUMNS[0]], COMIC_ROWS)),
  'blank-comic-panel-2x1': comic(1620, 610, grid(COMIC_COLUMNS, [COMIC_ROWS[0]])),
  'blank-comic-panel-2x2': comic(1620, 1220, grid(COMIC_COLUMNS, COMIC_ROWS)),
  // A title above the cross, and its four corners. The lines are left out.
  'blank-starter-pack': {
    width: 941,
    height: 960,
    panels: grid(
      [
        [0, 464],
        [487, 940],
      ],
      [
        [141, 470],
        [493, 823],
      ],
    ),
    texts: (_, at) => [
      textIn(WHOLE, { x: 50, y: 7.3, w: 94, h: 13 }, { ...STYLES.plain.style, bold: true, size: at(70) }),
    ],
  },
  // A title in the bar at the top, and each panel's label in the bar under it.
  'what-my-friends-think-i-do': {
    width: 640,
    height: 480,
    panels: [
      ...grid(
        [
          [6, 211],
          [216, 421],
          [428, 633],
        ],
        [[76, 221]],
      ),
      ...grid(
        [
          [7, 212],
          [217, 422],
          [429, 634],
        ],
        [[280, 425]],
      ),
    ],
    texts: (ps, at) => [
      textIn(WHOLE, { x: 50, y: 7.9, w: 94, h: 13 }, { size: at(42) }),
      ...ps.map((p, i) =>
        textIn(
          p,
          // The bar under the panel, as high as the space between the rows.
          { x: 50, y: 100 + (i < 3 ? 20 : 18), w: 100, h: i < 3 ? 34 : 30 },
          { ...STYLES.label.style, text: FRIENDS_LABELS[i], size: at(22) },
        ),
      ),
    ],
  },
  // A title above the grid, and a text in each square but the free one.
  'blank-bingo': {
    width: 848,
    height: 1041,
    panels: grid(
      [
        [43, 190],
        [193, 342],
        [347, 496],
        [500, 649],
        [653, 802],
      ],
      [
        [235, 385],
        [388, 537],
        [541, 690],
        [695, 843],
        [847, 996],
      ],
    ),
    texts: (ps, at) => [
      textIn(WHOLE, { x: 50, y: 11, w: 90, h: 18 }, { ...STYLES.plain.style, bold: true, size: at(80) }),
      ...ps
        .filter((_, i) => i !== 12)
        .map((p) => textIn(p, { x: 50, y: 50, w: 90, h: 90 }, { ...STYLES.plain.style, size: at(26) })),
    ],
  },
};

function layoutOfFormat(f: Format): Layout {
  const panels = f.panels.map(([x, y, w, h]): Panel => ({
    x: round((x / f.width) * 100),
    y: round((y / f.height) * 100),
    w: round((w / f.width) * 100),
    h: round((h / f.height) * 100),
  }));
  const unit = Math.min(f.width, f.height);
  return { panels, texts: f.texts(panels, (px) => clampField('size', (px / unit) * 100)) };
}

const LAYOUTS = new Map(Object.entries(FORMATS).map(([id, f]) => [id, layoutOfFormat(f)]));

/** The layout of a template, if it's a format made of panels. */
export const layoutOf = (id: string): Layout | undefined => LAYOUTS.get(id);

/** The templates that have a layout. */
export const LAID_OUT: readonly string[] = [...LAYOUTS.keys()];
