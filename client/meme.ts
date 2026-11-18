// Memes made from a template: texts and images laid over a picture, with
// optional space around it. DOM-free: the model, its URL encoding, the fitting
// of a text in its box, the geometry of moving, resizing and rotating layers,
// the undo history and the drawing, on any canvas-like context.

import { type Point, type Rect, normalizeColor } from './background.ts';

/**
 * Fonts a text can be set in. Impact is the page's own family (style.css): the
 * real one where it's installed, and Anton, which looks like it, elsewhere.
 * A heavy font is never drawn bold.
 */
export const FONTS = {
  impact: { name: 'Impact', family: "'Meme Impact', Impact, 'Arial Narrow', sans-serif", heavy: true },
  arial: { name: 'Arial', family: "Arial, Helvetica, 'Liberation Sans', sans-serif", heavy: false },
  comic: {
    name: 'Comic Sans',
    family: "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', cursive",
    heavy: false,
  },
  times: {
    name: 'Times',
    family: "'Times New Roman', Times, 'Liberation Serif', serif",
    heavy: false,
  },
  courier: {
    name: 'Courier',
    family: "'Courier New', Courier, 'Liberation Mono', monospace",
    heavy: false,
  },
} as const;

export type Font = keyof typeof FONTS;

export const ALIGNS = { left: 'Left', center: 'Centre', right: 'Right' } as const;
export type Align = keyof typeof ALIGNS;

export const VALIGNS = { top: 'Top', middle: 'Middle', bottom: 'Bottom' } as const;
export type VAlign = keyof typeof VALIGNS;

/**
 * Where a layer is, relative to the picture so that it stays put when space is
 * added around it: its centre and size in % of the picture's width (x, w) and
 * height (y, h), which the space around lies outside of (below 0, above 100).
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise, about the centre. */
  rotation: number;
}

export interface TextLayer extends Box {
  text: string;
  /** The largest the text is drawn, in % of the picture's smaller side: it shrinks to fit its box. */
  size: number;
  font: Font;
  color: string;
  outline: string;
  /** In % of the text's size (0 for none). */
  outlineWidth: number;
  align: Align;
  valign: VAlign;
  /** Drawn in capitals, whatever was typed. */
  caps: boolean;
  bold: boolean;
}

/** An image on top of the picture: its height follows from its width. */
export interface ImageLayer extends Omit<Box, 'h'> {
  /** A library template's id, or the key of an uploaded image (see `isLocal`). */
  image: string;
  /** Mirrored left to right. */
  flip: boolean;
}

/**
 * A panel of a format, where a picture can go: its left, top, width and
 * height in % of the picture's width (x, w) and height (y, h).
 */
export interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A picture filling a panel: as much of it as covers the panel, cropped about
 * a point of it, from close up or not.
 */
export interface Fill {
  /** The panel's index in its format's layout. */
  panel: number;
  /** A library template's id, or the key of an uploaded image (see `isLocal`). */
  image: string;
  /** 1 for the picture to cover the panel, cropped, more to be closer, and less to show more of it. */
  zoom: number;
  /** The point of the picture at the panel's middle, in % of its width and height. */
  x: number;
  y: number;
}

/** What a format is made of: its panels, and the texts a meme of it starts with. */
export interface Layout {
  panels: readonly Panel[];
  texts: readonly TextLayer[];
}

export interface Pad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Meme {
  /** Drawn over the images, the last one on top. */
  texts: TextLayer[];
  images: ImageLayer[];
  /** The pictures in the format's panels, a panel having one at most. Drawn under the images. */
  fills: Fill[];
  /** Space around the picture, in % of its height (top, bottom) and width (left, right). */
  pad: Pad;
  padColor: string;
  /** Width of the result in px, or 0 for the picture's own (and its space). */
  width: number;
}

/** What each number can be: the editor's slider ranges, and what URLs are clamped to. */
export const LIMITS = {
  x: { min: -100, max: 200, step: 0.1 },
  y: { min: -100, max: 200, step: 0.1 },
  w: { min: 2, max: 300, step: 0.1 },
  h: { min: 2, max: 300, step: 0.1 },
  rotation: { min: -180, max: 180, step: 1 },
  size: { min: 1, max: 50, step: 0.5 },
  outlineWidth: { min: 0, max: 25, step: 1 },
  pad: { min: 0, max: 100, step: 1 },
  zoom: { min: 0.1, max: 5, step: 0.01 },
  focus: { min: 0, max: 100, step: 0.1 },
  width: { min: 64, max: 4000, step: 1 },
} as const;

export type NumberField = keyof typeof LIMITS;

/** Rounds a value to its field's step, within its limits. */
export function clampField(field: NumberField, value: number): number {
  const { min, max, step } = LIMITS[field];
  const rounded = Number((Math.round(value / step) * step).toFixed(2));
  return Math.min(max, Math.max(min, rounded));
}

export const MAX_LAYERS = 40;
export const MAX_TEXT = 1000;

/** The look of a text, which a style sets at once. */
export type TextStyle = Pick<TextLayer, 'font' | 'color' | 'outline' | 'outlineWidth' | 'caps' | 'bold'>;

export const STYLES = {
  classic: {
    name: 'Classic',
    title: 'White capitals with a black outline',
    style: { font: 'impact', color: '#ffffff', outline: '#000000', outlineWidth: 7, caps: true, bold: false },
  },
  plain: {
    name: 'Plain',
    title: 'Black text, for a caption on white',
    style: { font: 'arial', color: '#000000', outline: '#ffffff', outlineWidth: 0, caps: false, bold: false },
  },
  label: {
    name: 'Label',
    title: 'Bold white text with a black outline, to name things in the picture',
    style: { font: 'arial', color: '#ffffff', outline: '#000000', outlineWidth: 8, caps: false, bold: true },
  },
} as const satisfies Record<string, { name: string; title: string; style: TextStyle }>;

export type StyleKey = keyof typeof STYLES;

const STYLE_FIELDS = Object.keys(STYLES.classic.style) as (keyof TextStyle)[];

export const styleOf = (t: TextStyle): TextStyle => ({
  font: t.font,
  color: t.color,
  outline: t.outline,
  outlineWidth: t.outlineWidth,
  caps: t.caps,
  bold: t.bold,
});

/** The style a text is in, if it's exactly one of them. */
export const styleKeyOf = (t: TextStyle): StyleKey | null =>
  (Object.keys(STYLES) as StyleKey[]).find((key) =>
    STYLE_FIELDS.every((field) => STYLES[key].style[field] === t[field]),
  ) ?? null;

/** A new text: in the middle of the picture, in the classic style. */
export const TEXT_DEFAULT: Readonly<TextLayer> = {
  text: '',
  x: 50,
  y: 50,
  w: 94,
  h: 22,
  rotation: 0,
  size: 10,
  ...STYLES.classic.style,
  align: 'center',
  valign: 'middle',
};

export const IMAGE_DEFAULT: Readonly<ImageLayer> = {
  image: '',
  x: 50,
  y: 50,
  w: 30,
  rotation: 0,
  flip: false,
};

/** The texts a meme starts with: one at the top and one at the bottom, to type in. */
export const starter = (): TextLayer[] => [
  { ...TEXT_DEFAULT, y: 13, valign: 'top' },
  { ...TEXT_DEFAULT, y: 87, valign: 'bottom' },
];

/** The texts a meme of a layout starts with, or the starter texts without one. */
const startOf = (layout?: Layout): TextLayer[] => (layout ? layout.texts.map((t) => ({ ...t })) : starter());

export const blank = (layout?: Layout): Meme => ({
  texts: startOf(layout),
  images: [],
  fills: [],
  pad: { top: 0, right: 0, bottom: 0, left: 0 },
  padColor: '#ffffff',
  width: 0,
});

// Uploaded images are kept by the editor under keys of their own: they can't
// be part of a link.
const LOCAL = 'local:';
export const localKey = (n: number): string => `${LOCAL}${n}`;
export const isLocal = (image: string): boolean => image.startsWith(LOCAL);

const CAPTION_BAR = 25;

/**
 * Adds a caption above the picture: space for it, if there isn't enough yet,
 * and a plain text filling it.
 */
export function withCaption(m: Meme): Meme {
  const top = Math.max(m.pad.top, CAPTION_BAR);
  const text: TextLayer = {
    ...TEXT_DEFAULT,
    ...STYLES.plain.style,
    y: clampField('y', -top / 2),
    h: clampField('h', top * 0.8),
    size: 8,
  };
  return { ...m, pad: { ...m.pad, top }, texts: [...m.texts, text] };
}

// --- geometry

export interface Size {
  width: number;
  height: number;
}

/** The result, in px: its size, and where the picture is in it. */
export interface Frame extends Size {
  image: Rect;
}

// Canvases stop working somewhere above this.
const MAX_SIDE = 8000;

export function frameOf(m: Pick<Meme, 'pad' | 'width'>, picture: Size): Frame {
  const across = 1 + (m.pad.left + m.pad.right) / 100;
  const down = 1 + (m.pad.top + m.pad.bottom) / 100;
  const scale = Math.min(
    m.width ? m.width / (picture.width * across) : 1,
    MAX_SIDE / (picture.width * across),
    MAX_SIDE / (picture.height * down),
  );
  const image = {
    width: Math.max(1, Math.round(picture.width * scale)),
    height: Math.max(1, Math.round(picture.height * scale)),
  };
  // The whole is rounded, then shared out, for it to be the width asked for to the pixel.
  const width = Math.max(image.width, Math.round(picture.width * across * scale));
  const height = Math.max(image.height, Math.round(picture.height * down * scale));
  const before = (space: number, start: number, end: number, size: number): number =>
    end ? Math.min(space, Math.round((size * start) / 100)) : space;
  return {
    width,
    height,
    image: {
      x: before(width - image.width, m.pad.left, m.pad.right, image.width),
      y: before(height - image.height, m.pad.top, m.pad.bottom, image.height),
      ...image,
    },
  };
}

/** A box in the result, in px: its centre, its size and its angle in radians. */
export interface Placed {
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
}

export const place = (b: Box, f: Frame): Placed => ({
  cx: f.image.x + (b.x / 100) * f.image.width,
  cy: f.image.y + (b.y / 100) * f.image.height,
  width: (b.w / 100) * f.image.width,
  height: (b.h / 100) * f.image.height,
  angle: (b.rotation * Math.PI) / 180,
});

/** Degrees in (-180, 180]. */
export const normalizeAngle = (degrees: number): number => {
  const turn = ((degrees % 360) + 360) % 360;
  return turn > 180 ? turn - 360 : turn;
};

/** The box of a place in the result, within the limits. */
export const unplace = (p: Placed, f: Frame): Box => ({
  x: clampField('x', ((p.cx - f.image.x) / f.image.width) * 100),
  y: clampField('y', ((p.cy - f.image.y) / f.image.height) * 100),
  w: clampField('w', (p.width / f.image.width) * 100),
  h: clampField('h', (p.height / f.image.height) * 100),
  rotation: clampField('rotation', normalizeAngle((p.angle * 180) / Math.PI)),
});

/** An image layer's box: as high as its width makes it. */
export function imageBox(layer: ImageLayer, natural: Size, f: Frame): Box {
  const width = (layer.w / 100) * f.image.width;
  const height = natural.width ? (width * natural.height) / natural.width : 0;
  return {
    x: layer.x,
    y: layer.y,
    w: layer.w,
    h: (height / f.image.height) * 100,
    rotation: layer.rotation,
  };
}

/** The width (in % of the picture's) at which an image takes at most a share of the picture, each way. */
export function fitWidth(natural: Size, picture: Size, share = 40): number {
  const byHeight = share * (picture.height / picture.width) * (natural.width / natural.height);
  return clampField('w', Math.min(share, byHeight));
}

/** A panel's place in the result, in px. */
export const panelRect = (p: Panel, f: Frame): Rect => ({
  x: f.image.x + (p.x / 100) * f.image.width,
  y: f.image.y + (p.y / 100) * f.image.height,
  width: (p.w / 100) * f.image.width,
  height: (p.h / 100) * f.image.height,
});

/** Where a picture is drawn in a place: the part of it that's shown, and where that goes. */
export interface Cropped {
  source: Rect;
  target: Rect;
}

/**
 * How a picture fills a place: at a zoom of 1 it covers it, cropped about its
 * point but never past its edges; closer, it's cropped more; further, it may
 * not cover it any more, and is then in the middle of the place that way.
 */
export function crop(fill: Pick<Fill, 'zoom' | 'x' | 'y'>, natural: Size, into: Rect): Cropped {
  const scale = Math.max(into.width / natural.width, into.height / natural.height) * fill.zoom;
  const axis = (focus: number, size: number, room: number, start: number) => {
    const shown = Math.min(size, room / scale);
    const drawn = shown * scale;
    return {
      from: clamp((focus / 100) * size - shown / 2, 0, size - shown),
      shown,
      at: start + (room - drawn) / 2,
      drawn,
    };
  };
  const x = axis(fill.x, natural.width, into.width, into.x);
  const y = axis(fill.y, natural.height, into.height, into.y);
  return {
    source: { x: x.from, y: y.from, width: x.shown, height: y.shown },
    target: { x: x.at, y: y.at, width: x.drawn, height: y.drawn },
  };
}

/** The zoom at which a picture fits in a place, whole. */
export const fitZoom = (natural: Size, into: Size): number => {
  const across = into.width / natural.width;
  const down = into.height / natural.height;
  // Down, for it to fit to the pixel.
  return clampField('zoom', Math.floor((Math.min(across, down) / Math.max(across, down)) * 100) / 100);
};

/**
 * The point of a fill once its picture is dragged by (dx, dy) px of the
 * result: from the part that is shown, so that dragging back from an edge
 * moves it at once.
 */
export function pan(
  fill: Pick<Fill, 'zoom' | 'x' | 'y'>,
  natural: Size,
  into: Size,
  dx: number,
  dy: number,
): Pick<Fill, 'x' | 'y'> {
  const { source, target } = crop(fill, natural, { x: 0, y: 0, ...into });
  const scale = target.width / source.width;
  const along = (from: number, shown: number, size: number, by: number): number =>
    clampField('focus', (clamp(from + shown / 2 - by / scale, shown / 2, size - shown / 2) / size) * 100);
  return {
    x: along(source.x, source.width, natural.width, dx),
    y: along(source.y, source.height, natural.height, dy),
  };
}

/** A corner of a box: left or right (-1, 1), then top or bottom (-1, 1). */
export type Corner = readonly [-1 | 1, -1 | 1];

/** The sizes a box can have, in px. */
export interface SizeRange {
  min: Size;
  max: Size;
}

/**
 * The sizes `unplace` keeps as they are, and no smaller than can be grabbed.
 * An image's height follows from its width: only that one is limited.
 */
export function sizeRange(f: Frame, kind: 'text' | 'image'): SizeRange {
  const grip = Math.min(f.image.width, f.image.height) * 0.03;
  const width = (percent: number): number => (f.image.width * percent) / 100;
  const height = (percent: number): number => (f.image.height * percent) / 100;
  return {
    min: {
      width: Math.max(grip, width(LIMITS.w.min)),
      height: kind === 'image' ? 0 : Math.max(grip, height(LIMITS.h.min)),
    },
    max: { width: width(LIMITS.w.max), height: kind === 'image' ? Infinity : height(LIMITS.h.max) },
  };
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const UNLIMITED: SizeRange = { min: { width: 1, height: 1 }, max: { width: Infinity, height: Infinity } };

/**
 * A box with one corner dragged to a point, the opposite corner staying where
 * it is, whatever its angle and whichever limit stops it. `ratio` (width /
 * height) keeps its proportions.
 */
export function resize(
  p: Placed,
  [sx, sy]: Corner,
  to: Point,
  { min, max, ratio }: Partial<SizeRange> & { ratio?: number } = {},
): Placed {
  const lo = min ?? UNLIMITED.min;
  const hi = max ?? UNLIMITED.max;
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const ox = p.cx - ((sx * p.width) / 2) * cos + ((sy * p.height) / 2) * sin;
  const oy = p.cy - ((sx * p.width) / 2) * sin - ((sy * p.height) / 2) * cos;
  // The point, from the fixed corner, along the box's own axes.
  const dx = (to.x - ox) * cos + (to.y - oy) * sin;
  const dy = -(to.x - ox) * sin + (to.y - oy) * cos;
  let width = clamp(sx * dx, lo.width, hi.width);
  let height = clamp(sy * dy, lo.height, hi.height);
  if (ratio) {
    const most = Math.min(hi.width, hi.height * ratio);
    const least = Math.min(most, Math.max(lo.width, lo.height * ratio));
    width = clamp(Math.max(sx * dx, sy * dy * ratio), least, most);
    height = width / ratio;
  }
  return {
    cx: ox + ((sx * width) / 2) * cos - ((sy * height) / 2) * sin,
    cy: oy + ((sx * width) / 2) * sin + ((sy * height) / 2) * cos,
    width,
    height,
    angle: p.angle,
  };
}

/** The rotation that turns a box's top towards a point, in degrees. */
export const rotationTo = (centre: Point, to: Point): number =>
  normalizeAngle((Math.atan2(to.y - centre.y, to.x - centre.x) * 180) / Math.PI + 90);

/** The nearest multiple of `step` when within `tolerance` of it, or the value. */
export function snap(value: number, step: number, tolerance: number): number {
  const nearest = Math.round(value / step) * step || 0; // not -0
  return Math.abs(value - nearest) <= tolerance ? nearest : value;
}

// --- text fitting

export const LINE_HEIGHT = 1.15;

// A text shrinks down to this share of its size before it overflows its box.
const SMALLEST = 0.12;
const SHRINK = 0.94;

/**
 * Breaks a text into lines no wider than `width`, as measured by `measure`.
 * A word wider than that gets a line of its own.
 */
export function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = words.shift() ?? '';
    for (const word of words) {
      if (measure(`${line} ${word}`) <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export interface Fit {
  /** The size the text is drawn at, in px. */
  size: number;
  lines: string[];
}

/**
 * The lines and the size at which a text fits in a box: `maxSize` when it
 * does, and smaller until it does otherwise, down to a minimum at which it
 * overflows. `measure` gives a string's width for a size of 1.
 */
export function fitText(text: string, box: Size, maxSize: number, measure: (s: string) => number): Fit {
  for (let size = maxSize; ; size *= SHRINK) {
    const lines = wrap(text, box.width / size, measure);
    const fits =
      lines.length * LINE_HEIGHT * size <= box.height &&
      lines.every((line) => measure(line) * size <= box.width);
    if (fits || size * SHRINK < maxSize * SMALLEST) return { size, lines };
  }
}

// --- drawing

/** The part of CanvasRenderingContext2D the drawing uses, for images of type `I`. */
export interface Ctx<I> {
  font: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: string;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: I, x: number, y: number, w: number, h: number): void;
  drawImage(
    image: I,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/** The CSS font of a text, at a size in px. */
export const fontOf = (t: Pick<TextLayer, 'font' | 'bold'>, px: number): string =>
  `${t.bold && !FONTS[t.font].heavy ? 'bold ' : ''}${Math.round(px * 100) / 100}px ${FONTS[t.font].family}`;

/** The text as it's drawn. */
export const shownText = (t: Pick<TextLayer, 'text' | 'caps'>): string =>
  (t.caps ? t.text.toUpperCase() : t.text).trim();

// Widths are measured at this size, for precision.
const MEASURED_AT = 100;

/** Draws a text in its place, fitted to it. `unit` is the picture's smaller side, in px. */
export function paintText<I>(ctx: Ctx<I>, t: TextLayer, p: Placed, unit: number): void {
  const text = shownText(t);
  if (!text) return;
  ctx.save();
  ctx.font = fontOf(t, MEASURED_AT);
  const widths = new Map<string, number>();
  const measure = (s: string): number => {
    let width = widths.get(s);
    if (width === undefined) widths.set(s, (width = ctx.measureText(s).width / MEASURED_AT));
    return width;
  };
  const { size, lines } = fitText(text, p, (t.size / 100) * unit, measure);
  const lineHeight = size * LINE_HEIGHT;
  const block = lines.length * lineHeight;
  const x = t.align === 'left' ? -p.width / 2 : t.align === 'right' ? p.width / 2 : 0;
  const top = t.valign === 'top' ? -p.height / 2 : t.valign === 'bottom' ? p.height / 2 - block : -block / 2;

  ctx.font = fontOf(t, size);
  ctx.textAlign = t.align;
  ctx.textBaseline = 'middle';
  ctx.translate(p.cx, p.cy);
  ctx.rotate(p.angle);
  // Every outline first, or a line's would run over the line above.
  if (t.outlineWidth > 0) {
    ctx.strokeStyle = t.outline;
    ctx.lineWidth = 2 * (t.outlineWidth / 100) * size;
    ctx.lineJoin = 'round';
    lines.forEach((line, i) => ctx.strokeText(line, x, top + (i + 0.5) * lineHeight));
  }
  ctx.fillStyle = t.color;
  lines.forEach((line, i) => ctx.fillText(line, x, top + (i + 0.5) * lineHeight));
  ctx.restore();
}

/** A loaded image, and its own size. */
export interface Picture<I> extends Size {
  image: I;
}

/**
 * Draws the meme on a context of its frame's size: the space around, the
 * picture, the pictures in its `panels`, the images, then the texts. What
 * `pictures` doesn't have is left out.
 */
export function paint<I>(
  ctx: Ctx<I>,
  m: Meme,
  f: Frame,
  picture: I,
  pictures: (image: string) => Picture<I> | undefined,
  panels: readonly Panel[] = [],
): void {
  ctx.clearRect(0, 0, f.width, f.height);
  if (f.width > f.image.width || f.height > f.image.height) {
    ctx.fillStyle = m.padColor;
    ctx.fillRect(0, 0, f.width, f.height);
  }
  ctx.drawImage(picture, f.image.x, f.image.y, f.image.width, f.image.height);
  for (const fill of m.fills) {
    const panel = panels[fill.panel];
    const pic = panel && pictures(fill.image);
    if (!pic) continue;
    const { source: s, target: t } = crop(fill, pic, panelRect(panel, f));
    ctx.drawImage(pic.image, s.x, s.y, s.width, s.height, t.x, t.y, t.width, t.height);
  }
  for (const layer of m.images) {
    const pic = pictures(layer.image);
    if (!pic) continue;
    const p = place(imageBox(layer, pic, f), f);
    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.rotate(p.angle);
    if (layer.flip) ctx.scale(-1, 1);
    ctx.drawImage(pic.image, -p.width / 2, -p.height / 2, p.width, p.height);
    ctx.restore();
  }
  const unit = Math.min(f.image.width, f.image.height);
  for (const t of m.texts) paintText(ctx, t, place(t, f), unit);
}

// --- URL encoding

// A layer's fields are short tokens joined by "_" ("y13_vtop"): a letter for
// the field, then its value. Only those that differ from the default are there.
const TEXT_KEYS = {
  x: 'x',
  y: 'y',
  w: 'w',
  h: 'h',
  rotation: 'r',
  size: 's',
  font: 'f',
  color: 'c',
  outline: 'o',
  outlineWidth: 'l',
  align: 'a',
  valign: 'v',
  caps: 'u',
  bold: 'b',
} as const satisfies Record<Exclude<keyof TextLayer, 'text'>, string>;

const IMAGE_KEYS = {
  x: 'x',
  y: 'y',
  w: 'w',
  rotation: 'r',
  flip: 'm',
} as const satisfies Record<Exclude<keyof ImageLayer, 'image'>, string>;

const FILL_KEYS = {
  panel: 'n',
  zoom: 'z',
  x: 'x',
  y: 'y',
} as const satisfies Record<Exclude<keyof Fill, 'image'>, string>;

export const FILL_DEFAULT: Readonly<Fill> = { panel: 0, image: '', zoom: 1, x: 50, y: 50 };

function encodeFields<T extends object>(
  layer: T,
  fallback: T,
  keys: Partial<Record<keyof T, string>>,
): string {
  return (Object.entries(keys) as [keyof T, string][])
    .filter(([field]) => layer[field] !== fallback[field])
    .map(([field, key]) => {
      const value = layer[field];
      if (typeof value === 'boolean') return `${key}${value ? 1 : 0}`;
      return key + (typeof value === 'string' && value.startsWith('#') ? value.slice(1) : String(value));
    })
    .join('_');
}

const decodeFields = (fields: string): Map<string, string> =>
  new Map(
    fields
      .split('_')
      .filter(Boolean)
      .map((token) => [token[0], token.slice(1)]),
  );

function number(field: NumberField, raw: string | undefined, fallback: number): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? clampField(field, n) : fallback;
}

const option = <T extends string>(options: Record<T, unknown>, raw: string | undefined, fallback: T): T =>
  raw !== undefined && Object.hasOwn(options, raw) ? (raw as T) : fallback;

const flag = (raw: string | undefined, fallback: boolean): boolean =>
  raw === '1' ? true : raw === '0' ? false : fallback;

function decodeText(text: string, fields: string): TextLayer {
  const f = decodeFields(fields);
  const d = TEXT_DEFAULT;
  return {
    text: text.replaceAll('\r\n', '\n').slice(0, MAX_TEXT),
    x: number('x', f.get(TEXT_KEYS.x), d.x),
    y: number('y', f.get(TEXT_KEYS.y), d.y),
    w: number('w', f.get(TEXT_KEYS.w), d.w),
    h: number('h', f.get(TEXT_KEYS.h), d.h),
    rotation: number('rotation', f.get(TEXT_KEYS.rotation), d.rotation),
    size: number('size', f.get(TEXT_KEYS.size), d.size),
    font: option(FONTS, f.get(TEXT_KEYS.font), d.font),
    color: normalizeColor(f.get(TEXT_KEYS.color) ?? '') ?? d.color,
    outline: normalizeColor(f.get(TEXT_KEYS.outline) ?? '') ?? d.outline,
    outlineWidth: number('outlineWidth', f.get(TEXT_KEYS.outlineWidth), d.outlineWidth),
    align: option(ALIGNS, f.get(TEXT_KEYS.align), d.align),
    valign: option(VALIGNS, f.get(TEXT_KEYS.valign), d.valign),
    caps: flag(f.get(TEXT_KEYS.caps), d.caps),
    bold: flag(f.get(TEXT_KEYS.bold), d.bold),
  };
}

function decodeImage(image: string, fields: string): ImageLayer {
  const f = decodeFields(fields);
  const d = IMAGE_DEFAULT;
  return {
    image,
    x: number('x', f.get(IMAGE_KEYS.x), d.x),
    y: number('y', f.get(IMAGE_KEYS.y), d.y),
    w: number('w', f.get(IMAGE_KEYS.w), d.w),
    rotation: number('rotation', f.get(IMAGE_KEYS.rotation), d.rotation),
    flip: flag(f.get(IMAGE_KEYS.flip), d.flip),
  };
}

/** A fill, unless its panel isn't one of the `count` there are. */
function decodeFill(image: string, fields: string, count: number): Fill | null {
  const f = decodeFields(fields);
  const d = FILL_DEFAULT;
  const panel = Number(f.get(FILL_KEYS.panel) ?? d.panel);
  if (!Number.isInteger(panel) || panel < 0 || panel >= count) return null;
  return {
    panel,
    image,
    zoom: number('zoom', f.get(FILL_KEYS.zoom), d.zoom),
    x: number('focus', f.get(FILL_KEYS.x), d.x),
    y: number('focus', f.get(FILL_KEYS.y), d.y),
  };
}

const PAD_SIDES = ['top', 'right', 'bottom', 'left'] as const;

const textKey = (t: TextLayer): string => `${t.text}\n${encodeFields(t, TEXT_DEFAULT, TEXT_KEYS)}`;

const sameTexts = (a: readonly TextLayer[], b: readonly TextLayer[]): boolean =>
  a.length === b.length && a.every((t, i) => textKey(t) === textKey(b[i]));

/**
 * URL parameters for a meme: only what differs from a blank one of its
 * layout. Each text is a `t` and its fields a `ts`, in turn, each image an
 * `i` and an `is`, and each panel's picture a `g` and a `gs`. Uploaded images
 * are left out.
 */
export function encode(m: Meme, layout?: Layout): URLSearchParams {
  const params = new URLSearchParams();
  // No text at all is said, or it would be the starter texts.
  if (!m.texts.length) params.set('nt', '1');
  else if (!sameTexts(m.texts, startOf(layout))) {
    for (const t of m.texts) {
      params.append('t', t.text);
      params.append('ts', encodeFields(t, TEXT_DEFAULT, TEXT_KEYS));
    }
  }
  for (const layer of m.images) {
    if (isLocal(layer.image)) continue;
    params.append('i', layer.image);
    params.append('is', encodeFields(layer, IMAGE_DEFAULT, IMAGE_KEYS));
  }
  for (const fill of m.fills) {
    if (isLocal(fill.image)) continue;
    params.append('g', fill.image);
    params.append('gs', encodeFields(fill, FILL_DEFAULT, FILL_KEYS));
  }
  if (PAD_SIDES.some((side) => m.pad[side])) params.set('p', PAD_SIDES.map((side) => m.pad[side]).join('-'));
  if (m.padColor !== '#ffffff') params.set('pc', m.padColor.slice(1));
  if (m.width) params.set('w', String(m.width));
  return params;
}

/**
 * A meme of a layout from URL parameters: invalid ones are ignored, numbers
 * clamped, and a panel only has the first picture given to it.
 */
export function decode(params: URLSearchParams, layout?: Layout): Meme {
  const m = blank(layout);
  const texts = params.getAll('t');
  const textFields = params.getAll('ts');
  if (texts.length || params.has('nt')) {
    m.texts = texts.slice(0, MAX_LAYERS).map((text, i) => decodeText(text, textFields[i] ?? ''));
  }
  const imageFields = params.getAll('is');
  m.images = params
    .getAll('i')
    .slice(0, MAX_LAYERS)
    .flatMap((image, i) => (image && !isLocal(image) ? decodeImage(image, imageFields[i] ?? '') : []));
  const fillFields = params.getAll('gs');
  const count = layout?.panels.length ?? 0;
  for (const [i, image] of params.getAll('g').entries()) {
    const fill = image && !isLocal(image) ? decodeFill(image, fillFields[i] ?? '', count) : null;
    if (fill && !m.fills.some((other) => other.panel === fill.panel)) m.fills.push(fill);
  }
  // All four sides or none: a part that isn't a size would pass the others on to the wrong sides.
  const pad = (params.get('p') ?? '').split('-');
  if (pad.length === PAD_SIDES.length && pad.every((part) => /^\d+(\.\d+)?$/.test(part))) {
    PAD_SIDES.forEach((side, i) => (m.pad[side] = number('pad', pad[i], 0)));
  }
  m.padColor = normalizeColor(params.get('pc') ?? '') ?? m.padColor;
  const width = Number(params.get('w') ?? '');
  if (Number.isFinite(width) && width > 0) m.width = clampField('width', width);
  return m;
}

/** What an editor link names: a template, and maybe one of its duplicates' files. */
export interface EditLink {
  id: string;
  file?: string;
  /** The meme's own parameters (see `decode`). */
  params: URLSearchParams;
}

const EDIT = '#edit/';

/** The link in a hash like `#edit/<template id>?f=<file>&…`, or null. */
export function parseEditHash(hash: string): EditLink | null {
  if (!hash.startsWith(EDIT)) return null;
  const at = hash.indexOf('?');
  let id: string;
  try {
    id = decodeURIComponent(at < 0 ? hash.slice(EDIT.length) : hash.slice(EDIT.length, at));
  } catch {
    return null;
  }
  if (!id) return null;
  const params = new URLSearchParams(at < 0 ? '' : hash.slice(at + 1));
  const file = params.get('f') || undefined;
  params.delete('f');
  return { id, ...(file && { file }), params };
}

export function editHash({
  id,
  file,
  params,
}: Omit<EditLink, 'params'> & { params?: URLSearchParams }): string {
  const all = new URLSearchParams(file ? { f: file } : {});
  for (const [key, value] of params ?? []) all.append(key, value);
  const query = all.toString();
  return `${EDIT}${id}${query ? `?${query}` : ''}`;
}

// --- undo

/** Snapshots of a design to go back and forth through. */
export interface History {
  /** Records a snapshot, unless it's the current one. What was undone is forgotten. */
  push(snapshot: string): void;
  /** The snapshot before the current one, which it becomes, or null. */
  undo(): string | null;
  redo(): string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export function createHistory(initial: string, limit = 200): History {
  let entries = [initial];
  let at = 0;
  return {
    push(snapshot) {
      if (snapshot === entries[at]) return;
      entries = [...entries.slice(Math.max(0, at + 2 - limit), at + 1), snapshot];
      at = entries.length - 1;
    },
    undo: () => (at > 0 ? entries[--at] : null),
    redo: () => (at < entries.length - 1 ? entries[++at] : null),
    get canUndo() {
      return at > 0;
    },
    get canRedo() {
      return at < entries.length - 1;
    },
  };
}
