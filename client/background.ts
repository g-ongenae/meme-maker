// Custom backgrounds in the style of advice-animal templates: slices from a
// centre point (sunburst), a radial glow, two halves, or a plain colour, with
// an image (a character) on top. DOM-free: the model, its URL encoding,
// presets and the drawing, on any canvas-like context.

export const PATTERNS = {
  sunburst: 'Sunburst',
  glow: 'Glow',
  split: 'Split',
  solid: 'Solid',
} as const;

export type Pattern = keyof typeof PATTERNS;

export const SPLITS = { horizontal: 'Top / bottom', vertical: 'Left / right' } as const;

export type Split = keyof typeof SPLITS;

export interface Background {
  width: number;
  height: number;
  pattern: Pattern;
  /**
   * The slices' colours, in turn; the glow's, from the centre out; the first
   * half's when split; the solid colour (the first one).
   */
  colors: string[];
  /** The second half's colours, when split. */
  colors2: string[];
  /** Whether the halves are top and bottom or left and right. They meet at the centre. */
  split: Split;
  /** Number of slices (rays, for the glow). */
  slices: number;
  /** Degrees clockwise from straight up to the first slice's edge. */
  rotation: number;
  /** How much the slices' widths vary, 0–100, drawn at random from `seed`. */
  irregularity: number;
  seed: number;
  /** The slices' (or glow's) centre, in % of the width and height. */
  cx: number;
  cy: number;
  /** Lines between slices: width in px per 1000 px of the smaller side (0 for none). */
  lineWidth: number;
  lineColor: string;
  /** Darkening across each slice, 0–100. */
  shade: number;
  /** The glow's light rays, 0–100. */
  rays: number;
  /** Darkening towards the corners, 0–100. */
  vignette: number;
  /** Library template shown on top, by id. Uploaded images aren't part of the model. */
  image: string;
  /** The image's centre, in % of the width and height. */
  ix: number;
  iy: number;
  /** The image's height, in % of the background's. */
  scale: number;
  /** White halo around the image, 0–100. */
  halo: number;
}

/** What each number field can be: the editor's slider ranges, and what URLs are clamped to. */
export const LIMITS = {
  width: { min: 16, max: 4000, step: 1 },
  height: { min: 16, max: 4000, step: 1 },
  slices: { min: 2, max: 48, step: 1 },
  rotation: { min: 0, max: 359, step: 1 },
  irregularity: { min: 0, max: 100, step: 1 },
  seed: { min: 0, max: 2 ** 31 - 1, step: 1 },
  cx: { min: 0, max: 100, step: 0.1 },
  cy: { min: 0, max: 100, step: 0.1 },
  lineWidth: { min: 0, max: 40, step: 1 },
  shade: { min: 0, max: 100, step: 1 },
  rays: { min: 0, max: 100, step: 1 },
  vignette: { min: 0, max: 100, step: 1 },
  ix: { min: 0, max: 100, step: 0.1 },
  iy: { min: 0, max: 100, step: 0.1 },
  scale: { min: 5, max: 200, step: 1 },
  halo: { min: 0, max: 100, step: 1 },
} as const satisfies Partial<Record<keyof Background, { min: number; max: number; step: number }>>;

export type NumberField = keyof typeof LIMITS;

export const MAX_COLORS = 8;

export const DEFAULT: Readonly<Background> = {
  width: 800,
  height: 800,
  pattern: 'sunburst',
  colors: ['#2d4fa3', '#b4bde0', '#ffffff'],
  colors2: ['#0a7aff', '#0a66f5'],
  split: 'horizontal',
  slices: 12,
  rotation: 0,
  irregularity: 0,
  seed: 1,
  cx: 50,
  cy: 50,
  lineWidth: 0,
  lineColor: '#000000',
  shade: 0,
  rays: 0,
  vignette: 0,
  image: '',
  ix: 50,
  iy: 50,
  scale: 80,
  halo: 0,
};

/** The fields a preset sets: the look, not the size or the image. */
export type Style = Omit<Background, 'width' | 'height' | 'image' | 'ix' | 'iy' | 'scale' | 'halo'>;

const STYLE_DEFAULT: Style = {
  pattern: DEFAULT.pattern,
  colors: DEFAULT.colors,
  colors2: DEFAULT.colors2,
  split: DEFAULT.split,
  slices: DEFAULT.slices,
  rotation: DEFAULT.rotation,
  irregularity: DEFAULT.irregularity,
  seed: DEFAULT.seed,
  cx: DEFAULT.cx,
  cy: DEFAULT.cy,
  lineWidth: DEFAULT.lineWidth,
  lineColor: DEFAULT.lineColor,
  shade: DEFAULT.shade,
  rays: DEFAULT.rays,
  vignette: DEFAULT.vignette,
};

/** Looks of well-known templates, to start from. Unset fields are the defaults. */
export const PRESETS: Record<string, { name: string; style: Partial<Style> }> = {
  facebook: { name: 'Annoying Facebook Girl', style: {} },
  rainbow: {
    name: 'Advice Dog (rainbow)',
    style: {
      colors: ['#00ee00', '#ffee00', '#ff8000', '#ee0000', '#ff00ff', '#0000ff'],
      slices: 6,
      rotation: 60,
      irregularity: 35,
      seed: 7,
    },
  },
  chicken: {
    name: 'Anti-Joke Chicken',
    style: { colors: ['#ff8a92', '#e65c0c'], slices: 6, rotation: 15, irregularity: 30, seed: 3 },
  },
  cat: {
    name: 'Business Cat',
    style: {
      colors: ['#cc9966', '#ee1122', '#663388', '#11bbbb', '#ff6622', '#bbdd77'],
      slices: 6,
      rotation: 20,
      irregularity: 40,
      seed: 11,
    },
  },
  owl: {
    name: 'Art Student Owl',
    style: { colors: ['#9a7a2a', '#a9a89a', '#33335a'], slices: 6, rotation: 40, irregularity: 30, seed: 5 },
  },
  kid: {
    name: 'Success Kid',
    style: {
      colors: ['#4a4a8c', '#aab8f8', '#23255a', '#4a6aa8'],
      slices: 8,
      rotation: 30,
      irregularity: 30,
    },
  },
  frog: {
    name: 'Foul Bachelor Frog',
    style: { colors: ['#449a3a', '#006a3a'], slices: 6, rotation: 10, irregularity: 30, seed: 9 },
  },
  hawkward: {
    name: 'Hawkward',
    style: { colors: ['#00e022', '#0b8cff'], slices: 4, rotation: 315 },
  },
  chuck: {
    name: 'Chuck Norris With Guns',
    style: {
      colors: ['#ee1122', '#00aaee'],
      slices: 16,
      rotation: 8,
      lineWidth: 5,
      irregularity: 25,
      seed: 4,
    },
  },
  chris: {
    name: 'Contradictory Chris',
    style: { colors: ['#a4ec14', '#8a0a3a'], slices: 22 },
  },
  panda: {
    name: 'Pickup Line Panda',
    style: {
      colors: ['#ffffff', '#999999', '#bbbbbb', '#666666', '#444444', '#dddddd', '#888888'],
      slices: 28,
      irregularity: 45,
      seed: 2,
    },
  },
  musical: {
    name: 'Musically Oblivious 8th Grader',
    style: {
      colors: ['#99908a', '#55504a', '#e8e4e0', '#77706a'],
      slices: 8,
      shade: 60,
      irregularity: 30,
      seed: 6,
    },
  },
  penguin: {
    name: 'Socially Awesome Awkward Penguin',
    style: {
      pattern: 'split',
      colors: ['#ff3a1a', '#ff2a0a'],
      colors2: ['#0a7aff', '#0a66f5'],
      slices: 8,
      rotation: 0,
    },
  },
  wolf: {
    name: 'Courage Wolf',
    style: {
      pattern: 'glow',
      colors: ['#fff6b0', '#ffcc11', '#ee7700'],
      slices: 28,
      rays: 45,
      irregularity: 50,
    },
  },
  alone: {
    name: 'Forever Alone',
    style: {
      pattern: 'glow',
      colors: ['#8aa8bc', '#1a3444', '#02080c'],
      slices: 40,
      rays: 12,
      irregularity: 60,
      vignette: 40,
    },
  },
  yuno: { name: 'Y U No', style: { pattern: 'solid', colors: ['#2b4764'] } },
};

/** Applies a preset's look, keeping the size and the image. */
export const applyPreset = (b: Background, style: Partial<Style>): Background => ({
  ...b,
  ...STYLE_DEFAULT,
  ...style,
});

// --- colours

/** `#rrggbb` for a 3- or 6-digit hex colour (with or without `#`), or null. */
export function normalizeColor(s: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${hex.toLowerCase()}`;
}

/** Mixes a `#rrggbb` colour with black by `amount` (0–1). */
export function darken(color: string, amount: number): string {
  const n = parseInt(color.slice(1), 16);
  const channel = (shift: number) =>
    Math.round(((n >> shift) & 0xff) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

// --- geometry

/** Seeded pseudo-random numbers in [0, 1) (mulberry32), so a design always draws the same. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const TAU = 2 * Math.PI;

/**
 * The slices' edges, as canvas angles (radians clockwise from the right): one
 * more than there are slices, from the first edge to it again a turn later.
 */
export function sliceEdges(b: Pick<Background, 'slices' | 'rotation' | 'irregularity' | 'seed'>): number[] {
  const rand = random(b.seed);
  const spread = (b.irregularity / 100) * 0.85;
  const widths = Array.from({ length: b.slices }, () => 1 + spread * (rand() * 2 - 1));
  const total = widths.reduce((sum, w) => sum + w, 0);
  const edges = [((b.rotation - 90) * Math.PI) / 180];
  for (const w of widths) edges.push(edges.at(-1)! + (w / total) * TAU);
  return edges;
}

/**
 * Each slice's colour: the palette in turn, except that the last slice never
 * takes the first one's colour when another is available, so the two don't merge.
 */
export function sliceColors(palette: readonly string[], slices: number): string[] {
  const colors = Array.from({ length: slices }, (_, i) => palette[i % palette.length]);
  if (slices > 2 && colors.at(-1) === colors[0]) {
    const other = palette.find((c) => c !== colors[0] && c !== colors.at(-2));
    if (other) colors[slices - 1] = other;
  }
  return colors;
}

export interface Point {
  x: number;
  y: number;
}

export const centre = (b: Background): Point => ({ x: (b.cx / 100) * b.width, y: (b.cy / 100) * b.height });

/** Distance from a point to the farthest corner: how far slices must reach. */
export const reach = (b: Background, p: Point): number =>
  Math.max(
    Math.hypot(p.x, p.y),
    Math.hypot(b.width - p.x, p.y),
    Math.hypot(p.x, b.height - p.y),
    Math.hypot(b.width - p.x, b.height - p.y),
  );

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where an image of the given size goes on the background. */
export function imageRect(b: Background, size: { width: number; height: number }): Rect {
  const height = (b.scale / 100) * b.height;
  const width = size.height ? (height * size.width) / size.height : 0;
  return { x: (b.ix / 100) * b.width - width / 2, y: (b.iy / 100) * b.height - height / 2, width, height };
}

/** The two halves of a split background, at the centre. */
export function halves(b: Background): [Rect, Rect] {
  const { x, y } = centre(b);
  return b.split === 'horizontal'
    ? [
        { x: 0, y: 0, width: b.width, height: y },
        { x: 0, y, width: b.width, height: b.height - y },
      ]
    : [
        { x: 0, y: 0, width: x, height: b.height },
        { x, y: 0, width: b.width - x, height: b.height },
      ];
}

// --- drawing

export interface Gradient {
  addColorStop(offset: number, color: string): void;
}

/** The part of CanvasRenderingContext2D the drawing uses. */
export interface Ctx {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Gradient;
  createConicGradient(startAngle: number, x: number, y: number): Gradient;
}

// Adjacent slices overlap by about a pixel, or antialiasing leaves seams between them.
const OVERLAP_PX = 1;

function wedge(ctx: Ctx, c: Point, radius: number, from: number, to: number): void {
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.arc(c.x, c.y, radius, from, to);
  ctx.closePath();
}

function drawSlices(ctx: Ctx, b: Background, palette: readonly string[]): void {
  const c = centre(b);
  const radius = reach(b, c) + 2;
  const edges = sliceEdges(b);
  const colors = sliceColors(palette, b.slices);
  const overlap = OVERLAP_PX / radius;
  colors.forEach((color, i) => {
    const [from, to] = [edges[i], edges[i + 1]];
    if (b.shade > 0) {
      // Light at the slice's first edge, darker at its last.
      const g = ctx.createConicGradient(from, c.x, c.y);
      g.addColorStop(0, color);
      g.addColorStop(Math.min(1, (to - from) / TAU), darken(color, (b.shade / 100) * 0.6));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = color;
    }
    wedge(ctx, c, radius, from, to + overlap);
    ctx.fill();
  });
  if (b.lineWidth > 0) {
    ctx.beginPath();
    for (const angle of edges.slice(0, -1)) {
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + Math.cos(angle) * radius, c.y + Math.sin(angle) * radius);
    }
    ctx.strokeStyle = b.lineColor;
    ctx.lineWidth = (b.lineWidth * Math.min(b.width, b.height)) / 1000;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function drawGlow(ctx: Ctx, b: Background): void {
  const c = centre(b);
  const radius = reach(b, c);
  const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
  const last = Math.max(1, b.colors.length - 1);
  b.colors.forEach((color, i) => g.addColorStop(i / last, color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, b.width, b.height);
  if (b.rays <= 0) return;

  // Every other slice is a ray of light, fading out from the centre.
  const light = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
  light.addColorStop(0, `rgb(255 255 255 / ${b.rays / 100})`);
  light.addColorStop(1, 'rgb(255 255 255 / 0)');
  ctx.fillStyle = light;
  const edges = sliceEdges(b);
  for (let i = 0; i < b.slices; i += 2) {
    wedge(ctx, c, radius + 2, edges[i], edges[i + 1]);
    ctx.fill();
  }
}

function drawVignette(ctx: Ctx, b: Background): void {
  const x = b.width / 2;
  const y = b.height / 2;
  const radius = Math.hypot(x, y);
  const g = ctx.createRadialGradient(x, y, radius * 0.35, x, y, radius);
  g.addColorStop(0, 'rgb(0 0 0 / 0)');
  g.addColorStop(1, `rgb(0 0 0 / ${(b.vignette / 100) * 0.9})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, b.width, b.height);
}

/** Draws the background (not the image on top) on a context of its size. */
export function paint(ctx: Ctx, b: Background): void {
  ctx.save();
  switch (b.pattern) {
    case 'solid':
      ctx.fillStyle = b.colors[0];
      ctx.fillRect(0, 0, b.width, b.height);
      break;
    case 'sunburst':
      drawSlices(ctx, b, b.colors);
      break;
    case 'split':
      halves(b).forEach((half, i) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(half.x, half.y, half.width, half.height);
        ctx.clip();
        drawSlices(ctx, b, i ? b.colors2 : b.colors);
        ctx.restore();
      });
      break;
    case 'glow':
      drawGlow(ctx, b);
      break;
  }
  if (b.vignette > 0) drawVignette(ctx, b);
  ctx.restore();
}

// --- URL encoding

// Short URL parameter names.
const KEYS = {
  width: 'w',
  height: 'h',
  pattern: 'p',
  colors: 'c',
  colors2: 'c2',
  split: 'd',
  slices: 'n',
  rotation: 'r',
  irregularity: 'j',
  seed: 's',
  cx: 'x',
  cy: 'y',
  lineWidth: 'lw',
  lineColor: 'lc',
  shade: 'sh',
  rays: 'ra',
  vignette: 'v',
  image: 'img',
  ix: 'ix',
  iy: 'iy',
  scale: 'is',
  halo: 'ih',
} as const satisfies Record<keyof Background, string>;

const encodeColors = (colors: readonly string[]) => colors.map((c) => c.slice(1)).join('-');

/** Rounds a value to its field's step, within its limits. */
export function clampField(field: NumberField, value: number): number {
  const { min, max, step } = LIMITS[field];
  const rounded = step < 1 ? Math.round(value * 10) / 10 : Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

/** URL parameters for a background: only the fields that differ from the default. */
export function encode(b: Background): URLSearchParams {
  const params = new URLSearchParams();
  for (const [field, key] of Object.entries(KEYS) as [keyof Background, string][]) {
    const value = b[field];
    const fallback = DEFAULT[field];
    if (Array.isArray(value)) {
      const s = encodeColors(value);
      if (s !== encodeColors(fallback as string[])) params.set(key, s);
    } else if (value !== fallback) {
      params.set(key, typeof value === 'string' && value.startsWith('#') ? value.slice(1) : String(value));
    }
  }
  return params;
}

/** A background from URL parameters: invalid ones are ignored and numbers clamped. */
export function decode(params: URLSearchParams): Background {
  const b: Background = { ...DEFAULT };
  for (const field of Object.keys(LIMITS) as NumberField[]) {
    const raw = params.get(KEYS[field]);
    const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
    if (Number.isFinite(n)) b[field] = clampField(field, n);
  }
  const pattern = params.get(KEYS.pattern);
  if (pattern !== null && Object.hasOwn(PATTERNS, pattern)) b.pattern = pattern as Pattern;
  const split = params.get(KEYS.split);
  if (split !== null && Object.hasOwn(SPLITS, split)) b.split = split as Split;
  for (const field of ['colors', 'colors2'] as const) {
    const colors = (params.get(KEYS[field]) ?? '')
      .split('-')
      .flatMap((c) => normalizeColor(c) ?? [])
      .slice(0, MAX_COLORS);
    if (colors.length) b[field] = colors;
  }
  const line = normalizeColor(params.get(KEYS.lineColor) ?? '');
  if (line) b.lineColor = line;
  b.image = params.get(KEYS.image) ?? '';
  return b;
}
