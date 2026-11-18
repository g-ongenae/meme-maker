// Meme editor: a dialog with a live preview of a meme (see meme.ts) made from
// a picture, a template's or one from the background editor, and its
// controls. Texts and images are layers over the picture: each has a box over
// the preview to drag, resize and rotate it by. A format made of panels
// (formats.ts) has a box for each panel too, to fill it with a template or an
// uploaded picture, and to move it by. The design is kept in the URL hash
// (#edit/<template>?…) so it can be bookmarked or shared; uploaded images
// stay local.

import { type Point, normalizeColor } from './background.ts';
import { categoryOf } from './categories.ts';
import { $ } from './dom.ts';
import { layoutOf } from './formats.ts';
import {
  type Box,
  type Corner,
  type Fill,
  type Frame,
  type History,
  type ImageLayer,
  type Layout,
  type Meme,
  type Panel,
  type Picture,
  type Placed,
  type Size,
  type TextLayer,
  ALIGNS,
  FONTS,
  LIMITS,
  MAX_LAYERS,
  MAX_TEXT,
  STYLES,
  TEXT_DEFAULT,
  FILL_DEFAULT,
  IMAGE_DEFAULT,
  VALIGNS,
  blank,
  clampField,
  createHistory,
  decode,
  editHash,
  encode,
  fitWidth,
  fitZoom,
  fontOf,
  frameOf,
  imageBox,
  isLocal,
  localKey,
  paint,
  pan,
  panelRect,
  place,
  resize,
  rotationTo,
  shownText,
  sizeRange,
  snap,
  styleKeyOf,
  styleOf,
  unplace,
  withCaption,
} from './meme.ts';
import { type Template, fold, searchWords, stillUrl, thumbUrl } from './templates.ts';

/** The picture a meme is made from. */
export interface Base {
  name: string;
  /** The picture's address. */
  src: string;
  /** The template it is, for the design to be kept in the URL hash: not for a local picture. */
  link?: { id: string; file?: string };
  /** Called once the editor is done with the picture: closed, or opened on another. */
  dispose?(): void;
}

export interface MemeEditor {
  /**
   * Opens the editor on a picture, with the design in the parameters. Without
   * any, it's the one left there last time, or the starter texts.
   */
  open(base: Base, params?: URLSearchParams): void;
  close(): void;
  readonly isOpen: boolean;
  /** Templates the images on top can be picked from, once loaded. */
  setLibrary(templates: Template[]): void;
  /** Downloads the meme, once its picture is loaded. */
  download(): void;
  /** Copies the meme to the clipboard, when it can: false when it can't. */
  copy(): boolean;
  /** Goes to the characters' search. */
  focusSearch(): void;
}

type Selection = { kind: 'text' | 'image' | 'panel'; index: number };
type LayerSelection = Selection & { kind: 'text' | 'image' };

const CORNERS: Corner[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

// A layer dragged this close to the picture's middle (in %) goes right on it.
const SNAP = 1.2;
// Rotating by the handle stops at these angles when this close, in degrees.
const SNAP_ANGLES = 45;
const SNAP_ANGLE = 4;

type Drag =
  | { mode: 'move'; start: Point; origin: Point }
  | { mode: 'resize'; corner: Corner; origin: Placed; grab: Point; ratio?: number }
  | { mode: 'rotate'; centre: Point }
  | { mode: 'pan'; start: Point; origin: Point };

// The wheel zooms a panel's picture by this much per notch (100 px).
const WHEEL_ZOOM = 1.15;

export function createMemeEditor({ onClose }: { onClose(base: Base): void }): MemeEditor {
  const dialog = $<HTMLDialogElement>('meme');
  const stage = $('memeStage');
  const wrap = $('memeCanvas');
  const canvas = $<HTMLCanvasElement>('memePicture');
  const ctx = canvas.getContext('2d')!;
  const layers = $('memeLayers');
  const panelBoxes = $('memePanels');
  const guides = { x: $('guideX'), y: $('guideY') };
  const form = $<HTMLFormElement>('memeForm');
  const textList = $<HTMLUListElement>('memeTexts');
  const textStyle = $('textStyle');
  const imageStyle = $('imageStyle');
  const stickers = $<HTMLUListElement>('stickers');
  const stickersEmpty = $('stickersEmpty');
  const stickerSearch = $<HTMLInputElement>('stickerSearch');
  const stickerFile = $<HTMLInputElement>('stickerFile');
  const panelSection = $('panelSection');
  const panelList = $<HTMLUListElement>('panelList');
  const panelHint = $('panelHint');
  const panelLibrary = $<HTMLUListElement>('panelLibrary');
  const panelSearch = $<HTMLInputElement>('panelSearch');
  const panelFile = $<HTMLInputElement>('panelFile');
  const panelStyle = $('panelStyle');
  const dropHint = $('memeDrop');
  const meta = $('memeMeta');
  const undoButton = $<HTMLButtonElement>('memeUndo');
  const redoButton = $<HTMLButtonElement>('memeRedo');
  const copyButton = $<HTMLButtonElement>('memeCopy');
  const downloadButton = $<HTMLButtonElement>('memeDownload');

  let base: Base | null = null;
  let picture: HTMLImageElement | null = null; // the base's, once loaded
  let layout: Layout | undefined; // the base's, if it's a format made of panels
  let state: Meme = blank();
  let selected: Selection | null = null;
  let frame: Frame | null = null;
  let steps: History = createHistory(JSON.stringify(state));
  let byId = new Map<string, Template>();
  let drag: Drag | null = null;
  let uploads = 0;
  let fonts: Promise<unknown> | null = null;
  const locals = new Map<string, string>(); // object URLs of the uploaded images, by key
  const loaded = new Map<string, HTMLImageElement>(); // the layers' images, by address
  const loading = new Map<string, Promise<void>>(); // those asked for, done one way or the other
  const drafts = new Map<string, string>(); // the design left on each template, by address

  // --- static controls

  const ranges: Record<string, keyof typeof LIMITS> = {
    size: 'size',
    outlineWidth: 'outlineWidth',
    rotation: 'rotation',
    imageRotation: 'rotation',
    zoom: 'zoom',
    top: 'pad',
    right: 'pad',
    bottom: 'pad',
    left: 'pad',
    width: 'width',
  };
  for (const [name, field] of Object.entries(ranges)) {
    Object.assign(control(name), LIMITS[field]);
  }
  // Up to the size of the picture and more, but not as far as the limit: the corners go there.
  Object.assign(control('imageSize'), { min: LIMITS.w.min, max: 150, step: 1 });

  const fontSelect = form.elements.namedItem('font') as HTMLSelectElement;
  for (const [key, { name }] of Object.entries(FONTS)) fontSelect.append(new Option(name, key));

  function radios(
    container: HTMLElement,
    name: string,
    options: Record<string, string>,
    titles: Record<string, string> = {},
  ): void {
    for (const [key, label] of Object.entries(options)) {
      const option = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = name;
      radio.value = key;
      option.title = titles[key] ?? '';
      option.append(radio, label);
      container.append(option);
    }
  }
  radios(
    $('textStyles'),
    'style',
    Object.fromEntries(Object.entries(STYLES).map(([key, { name }]) => [key, name])),
    Object.fromEntries(Object.entries(STYLES).map(([key, { title }]) => [key, title])),
  );
  radios($('aligns'), 'align', ALIGNS);
  radios($('valigns'), 'valign', VALIGNS);

  copyButton.hidden = !('ClipboardItem' in window && navigator.clipboard?.write);

  function control(name: string): HTMLInputElement {
    return form.elements.namedItem(name) as HTMLInputElement;
  }

  // --- pictures

  const sourceOf = (image: string): string | undefined => {
    if (isLocal(image)) return locals.get(image);
    const t = byId.get(image);
    return (t && stillUrl(t)) ?? undefined;
  };

  /** Loads an image, once. One that can't be is left out, of the preview and of the result. */
  function load(src: string): Promise<void> {
    if (loaded.has(src)) return Promise.resolve();
    let settled = loading.get(src);
    if (!settled) {
      settled = new Promise((resolve) => {
        const el = new Image();
        el.onload = () => {
          loaded.set(src, el);
          draw();
          resolve();
        };
        el.onerror = () => resolve();
        el.src = src;
      });
      loading.set(src, settled);
    }
    return settled;
  }

  /** A layer's image once it's loaded, which it's asked to here. */
  function pictureOf(image: string): Picture<HTMLImageElement> | undefined {
    const src = sourceOf(image);
    if (!src) return undefined;
    const img = loaded.get(src);
    if (img) return { image: img, width: img.naturalWidth, height: img.naturalHeight };
    void load(src);
    return undefined;
  }

  // Until it's loaded, a library image's size is its template's.
  const sizeOf = (image: string): Size | undefined => pictureOf(image) ?? byId.get(image);

  const thumbOf = (image: string): string | undefined => {
    if (isLocal(image)) return locals.get(image);
    const t = byId.get(image);
    return t && thumbUrl(t);
  };

  const nameOf = (image: string): string => byId.get(image)?.name ?? 'Uploaded picture';

  // The canvas draws in a font only once it's loaded.
  function loadFonts(): Promise<unknown> {
    if (fonts) return fonts;
    const font = fontOf({ font: 'impact', bold: false }, 40);
    // A character of each range the font comes in.
    fonts = Promise.allSettled([document.fonts.load(font, 'A'), document.fonts.load(font, 'Ł')]).then(draw);
    return fonts;
  }

  // --- drawing

  const layerOf = (s: Selection): TextLayer | ImageLayer | undefined =>
    s.kind === 'text' ? state.texts[s.index] : s.kind === 'image' ? state.images[s.index] : undefined;

  const panels = (): readonly Panel[] => layout?.panels ?? [];

  const fillOf = (panel: number): Fill | undefined => state.fills.find((fill) => fill.panel === panel);

  const selectedPanel = (): number | null => (selected?.kind === 'panel' ? selected.index : null);

  /** Whether what a selection names is (still) there. */
  const exists = (s: Selection): boolean => (s.kind === 'panel' ? s.index < panels().length : !!layerOf(s));

  /** The panel a picture picked or uploaded for the panels goes to: the selected one, or the first empty one. */
  const targetPanel = (): number => {
    const at = selectedPanel();
    if (at !== null) return at;
    const empty = panels().findIndex((_, i) => !fillOf(i));
    return empty < 0 ? 0 : empty;
  };

  const selectedText = (): TextLayer | undefined =>
    selected?.kind === 'text' ? state.texts[selected.index] : undefined;

  const selectedImage = (): ImageLayer | undefined =>
    selected?.kind === 'image' ? state.images[selected.index] : undefined;

  /** A layer's box, unless it's an image whose size isn't known yet. */
  function boxOf(s: Selection): Box | null {
    if (s.kind === 'panel') return null;
    if (s.kind === 'text') return state.texts[s.index] ?? null;
    const layer = state.images[s.index];
    const size = layer && sizeOf(layer.image);
    return size && frame ? imageBox(layer, size, frame) : null;
  }

  // Images first: the texts are drawn over them.
  const order = (): LayerSelection[] => [
    ...state.images.map((_, index): LayerSelection => ({ kind: 'image', index })),
    ...state.texts.map((_, index): LayerSelection => ({ kind: 'text', index })),
  ];

  /** Where a box goes over the preview: its place in % of the result. */
  function position(el: HTMLElement, x: number, y: number, width: number, height: number, f: Frame): void {
    el.style.left = `${(x / f.width) * 100}%`;
    el.style.top = `${(y / f.height) * 100}%`;
    el.style.width = `${(width / f.width) * 100}%`;
    el.style.height = `${(height / f.height) * 100}%`;
  }

  // The boxes of the panels, under the layers': one per panel, where it is.
  function layoutPanels(f: Frame): void {
    const all = panels();
    while (panelBoxes.children.length > all.length) panelBoxes.lastElementChild!.remove();
    while (panelBoxes.children.length < all.length) {
      const el = document.createElement('div');
      el.className = 'panel';
      el.tabIndex = 0;
      el.role = 'button';
      el.setAttribute('aria-describedby', 'memePanelHelp');
      panelBoxes.append(el);
    }
    all.forEach((panel, i) => {
      const el = panelBoxes.children[i] as HTMLElement;
      const fill = fillOf(i);
      el.dataset.index = String(i);
      el.dataset.hint = `Panel ${i + 1}`;
      el.ariaLabel = `Panel ${i + 1}: ${fill ? nameOf(fill.image) : 'empty'}`;
      el.classList.toggle('filled', !!fill);
      el.classList.toggle('selected', selectedPanel() === i);
      const r = panelRect(panel, f);
      position(el, r.x, r.y, r.width, r.height, f);
    });
  }

  function buildLayer(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'layer';
    el.tabIndex = 0;
    el.role = 'button';
    el.setAttribute('aria-describedby', 'memeLayerHelp');
    for (const corner of CORNERS) {
      const handle = document.createElement('span');
      handle.className = 'handle';
      handle.dataset.corner = corner.join(',');
      el.append(handle);
    }
    const rotate = document.createElement('span');
    rotate.className = 'handle rotate';
    rotate.dataset.rotate = '';
    rotate.title = 'Drag to rotate';
    el.append(rotate);
    return el;
  }

  // The boxes over the preview: one per layer, where the layer is.
  function layoutLayers(f: Frame): void {
    const refs = order();
    while (layers.children.length > refs.length) layers.lastElementChild!.remove();
    while (layers.children.length < refs.length) layers.append(buildLayer());
    refs.forEach((ref, i) => {
      const el = layers.children[i] as HTMLElement;
      const box = boxOf(ref);
      el.hidden = !box;
      el.dataset.kind = ref.kind;
      el.dataset.index = String(ref.index);
      el.classList.toggle('selected', selected?.kind === ref.kind && selected.index === ref.index);
      const text = ref.kind === 'text' ? shownText(state.texts[ref.index]) : null;
      const label = `${ref.kind === 'text' ? 'Text' : 'Image'} ${ref.index + 1}`;
      el.classList.toggle('empty', text === '');
      el.dataset.hint = label;
      el.ariaLabel = text ? `${label}: ${text}` : label;
      if (!box) return;
      const p = place(box, f);
      position(el, p.cx - p.width / 2, p.cy - p.height / 2, p.width, p.height, f);
      el.style.rotate = `${box.rotation}deg`;
    });
  }

  let raf = 0;
  function draw(): void {
    raf ||= requestAnimationFrame(render);
  }

  function render(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    if (!picture) return;
    const f = frameOf(state, { width: picture.naturalWidth, height: picture.naturalHeight });
    frame = f;
    if (canvas.width !== f.width) canvas.width = f.width;
    if (canvas.height !== f.height) canvas.height = f.height;
    wrap.style.setProperty('--ratio', `${f.width} / ${f.height}`);
    wrap.style.setProperty('--aspect', String(f.width / f.height));
    paint(ctx, state, f, picture, pictureOf, panels());
    layoutPanels(f);
    layoutLayers(f);
    meta.textContent = `${f.width} × ${f.height} px · PNG`;
    // The width it has when none is asked for.
    if (!state.width) control('width').placeholder = String(f.width);
  }

  // --- saving: the undo history, the draft and the URL

  function commit(): void {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!base) return;
    const snapshot = JSON.stringify(state);
    steps.push(snapshot);
    if (base.link) drafts.set(base.src, snapshot);
    if (base.link && dialog.open) {
      const hash = editHash({ ...base.link, params: encode(state, layout) });
      history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    }
    syncHistory();
  }

  // Sliders and typing are saved once they pause: browsers limit how often
  // history can be replaced, and each save is a step to undo.
  let saveTimer = 0;
  function changed(): void {
    draw();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, 300);
  }

  /** After a change that is a step of its own. */
  function done(): void {
    draw();
    commit();
  }

  function syncHistory(): void {
    undoButton.disabled = !steps.canUndo;
    redoButton.disabled = !steps.canRedo;
  }

  function restore(snapshot: string | null): void {
    if (!snapshot) return;
    const active = document.activeElement;
    const typing = active instanceof HTMLTextAreaElement ? Number(active.dataset.index) : -1;
    state = JSON.parse(snapshot) as Meme;
    if (selected && !exists(selected)) selected = null;
    sync();
    textareaOf(typing)?.focus();
    done();
  }

  function undo(): void {
    if (saveTimer) commit();
    restore(steps.undo());
  }

  function redo(): void {
    if (saveTimer) commit();
    restore(steps.redo());
  }

  // --- controls from the state

  function setRange(name: string, value: number): void {
    const input = control(name);
    input.value = String(value);
    const output = input.nextElementSibling;
    if (output instanceof HTMLOutputElement) output.textContent = `${value}${input.dataset.unit ?? ''}`;
  }

  function check(name: string, value: string | null): void {
    for (const radio of form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
      radio.checked = radio.value === value;
    }
  }

  const textareaOf = (index: number): HTMLTextAreaElement | null =>
    textList.querySelector<HTMLTextAreaElement>(`textarea[data-index="${index}"]`);

  function renderTexts(): void {
    textList.replaceChildren(
      ...state.texts.map((t, i) => {
        const li = document.createElement('li');
        const input = document.createElement('textarea');
        input.rows = 2;
        input.maxLength = MAX_TEXT;
        input.value = t.text;
        input.placeholder = `Text ${i + 1}`;
        input.ariaLabel = `Text ${i + 1}`;
        input.dataset.index = String(i);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.dataset.remove = String(i);
        remove.ariaLabel = `Remove text ${i + 1}`;
        remove.title = 'Remove';
        remove.textContent = '✕';
        li.append(input, remove);
        return li;
      }),
    );
  }

  // A button per panel, showing its picture.
  function renderPanels(): void {
    panelList.replaceChildren(
      ...panels().map((_, i) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.panel = String(i);
        const fill = fillOf(i);
        const thumb = fill && thumbOf(fill.image);
        button.title = fill ? `Panel ${i + 1}: ${nameOf(fill.image)}` : `Panel ${i + 1}`;
        if (thumb) {
          const img = document.createElement('img');
          img.alt = '';
          img.src = thumb;
          button.append(img);
        }
        const n = document.createElement('span');
        n.textContent = String(i + 1);
        button.append(n);
        li.append(button);
        return li;
      }),
    );
  }

  // The controls of the selected layer or panel.
  function syncSelection(): void {
    [...textList.children].forEach((li, i) =>
      li.classList.toggle('selected', selected?.kind === 'text' && selected.index === i),
    );
    const t = selectedText();
    textStyle.hidden = !t;
    if (t && selected) {
      $('textStyleLabel').textContent = `Text ${selected.index + 1} style`;
      check('style', styleKeyOf(t));
      fontSelect.value = t.font;
      setRange('size', t.size);
      control('color').value = t.color;
      control('outline').value = t.outline;
      setRange('outlineWidth', t.outlineWidth);
      check('align', t.align);
      check('valign', t.valign);
      control('caps').checked = t.caps;
      control('bold').checked = t.bold;
      control('bold').disabled = FONTS[t.font].heavy;
      setRange('rotation', t.rotation);
    }
    const image = selectedImage();
    imageStyle.hidden = !image;
    if (image) {
      setRange('imageSize', Math.round(image.w));
      setRange('imageRotation', image.rotation);
      control('flip').checked = image.flip;
    }
    const at = selectedPanel();
    for (const button of panelList.querySelectorAll<HTMLElement>('button[data-panel]')) {
      button.ariaPressed = String(Number(button.dataset.panel) === at);
    }
    const target = targetPanel();
    const fill = at === null ? undefined : fillOf(at);
    panelHint.textContent = fill
      ? `Panel ${at! + 1}: ${nameOf(fill.image)}. Pick another to replace it.`
      : `Pick a template or upload a picture for panel ${target + 1}.`;
    panelStyle.hidden = !fill;
    if (fill) setRange('zoom', fill.zoom);
  }

  function sync(): void {
    renderTexts();
    renderPanels();
    panelSection.hidden = !panels().length;
    syncSelection();
    for (const side of ['top', 'right', 'bottom', 'left'] as const) setRange(side, state.pad[side]);
    control('padColor').value = state.padColor;
    control('width').value = state.width ? String(state.width) : '';
    syncHistory();
  }

  function select(next: Selection | null): void {
    if (selected?.kind === next?.kind && selected?.index === next?.index) return;
    selected = next;
    syncSelection();
    draw();
  }

  // --- panels

  /** Puts a picture in a panel, in place of the one there. */
  function fillPanel(panel: number, image: string): void {
    if (panel >= panels().length) return;
    state.fills = [...state.fills.filter((fill) => fill.panel !== panel), { ...FILL_DEFAULT, panel, image }];
    selected = { kind: 'panel', index: panel };
    renderPanels();
    syncSelection();
    done();
  }

  function emptyPanel(panel: number): void {
    if (!fillOf(panel)) return;
    state.fills = state.fills.filter((fill) => fill.panel !== panel);
    renderPanels();
    syncSelection();
    done();
  }

  /** A panel's size in the picture's own px. */
  function panelSize(panel: Panel): Size | null {
    return picture
      ? { width: (panel.w / 100) * picture.naturalWidth, height: (panel.h / 100) * picture.naturalHeight }
      : null;
  }

  /** Moves a panel's picture by (dx, dy) px of the result, from where it was. */
  function panPanel(panel: number, from: Point, dx: number, dy: number): void {
    const fill = fillOf(panel);
    const size = fill && sizeOf(fill.image);
    if (!fill || !size || !frame || !panels()[panel]) return;
    Object.assign(fill, pan({ ...fill, ...from }, size, panelRect(panels()[panel], frame), dx, dy));
  }

  function zoomPanel(panel: number, zoom: number): void {
    const fill = fillOf(panel);
    if (!fill) return;
    fill.zoom = clampField('zoom', zoom);
    setRange('zoom', fill.zoom);
    changed();
  }

  /** Selects a text and puts the cursor in it, to type. */
  function editText(index: number): void {
    select({ kind: 'text', index });
    const input = textareaOf(index);
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollIntoView({ block: 'nearest' });
  }

  // --- layers

  function addText(text: TextLayer): void {
    if (state.texts.length >= MAX_LAYERS) return;
    state.texts.push(text);
    selected = null;
    sync();
    editText(state.texts.length - 1);
    done();
  }

  // There is room for an image once there is a picture to put it on.
  const takesImage = (): boolean => !!picture && state.images.length < MAX_LAYERS;

  // The selected panel, where what's added goes.
  const panelAtHand = (): Panel | undefined => {
    const at = selectedPanel();
    return at === null ? undefined : panels()[at];
  };

  function addImage(image: string, size: Size): void {
    if (!picture || !takesImage()) return;
    const panel = panelAtHand();
    const inPanel = panel && panelSize(panel);
    const w =
      panel && inPanel
        ? clampField('w', (fitWidth(size, inPanel, 60) * panel.w) / 100)
        : fitWidth(size, { width: picture.naturalWidth, height: picture.naturalHeight });
    const at = panel
      ? { x: clampField('x', panel.x + panel.w / 2), y: clampField('y', panel.y + panel.h / 2) }
      : {};
    state.images.push({ ...IMAGE_DEFAULT, image, w, ...at });
    select({ kind: 'image', index: state.images.length - 1 });
    done();
  }

  // A copy, a little down and to the right of its original.
  const shifted = <T extends { x: number; y: number }>(layer: T): T => ({
    ...layer,
    x: clampField('x', layer.x + 4),
    y: clampField('y', layer.y + 6),
  });

  function remove(s: Selection): void {
    if (s.kind === 'panel') {
      emptyPanel(s.index);
      return;
    }
    (s.kind === 'text' ? state.texts : state.images).splice(s.index, 1);
    selected = null;
    sync();
    done();
  }

  /** Adds images on top, or puts the first one in a panel. */
  function upload(files: Iterable<File>, panel?: number): void {
    const on = base;
    const images = [...files].filter((file) => file.type.startsWith('image/'));
    for (const file of panel === undefined ? images : images.slice(0, 1)) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // It's for the picture it was given to, which may be gone by the time it's read.
        if (base !== on || (panel === undefined ? !takesImage() : panel >= panels().length)) {
          URL.revokeObjectURL(url);
          return;
        }
        const key = localKey(++uploads);
        locals.set(key, url);
        loaded.set(url, img);
        if (panel === undefined) addImage(key, { width: img.naturalWidth, height: img.naturalHeight });
        else fillPanel(panel, key);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        meta.textContent = `Could not read ${file.name}.`;
      };
      img.src = url;
    }
  }

  // Uploaded images are kept for as long as a design that can come back has them.
  function releaseUploads(): void {
    const kept = new Set(
      [...drafts.values()].flatMap((draft) => {
        const { images, fills } = JSON.parse(draft) as Meme;
        return [...images, ...fills].map((layer) => layer.image);
      }),
    );
    for (const [key, url] of locals) {
      if (kept.has(key)) continue;
      URL.revokeObjectURL(url);
      locals.delete(key);
      loaded.delete(url);
    }
  }

  /** Done with the picture at hand: what was about to be saved is, as its draft. */
  function leave(): Base | null {
    const left = base;
    if (saveTimer && left?.link) drafts.set(left.src, JSON.stringify(state));
    clearTimeout(saveTimer);
    saveTimer = 0;
    base = null;
    picture = null;
    frame = null;
    drag = null;
    downloadButton.disabled = copyButton.disabled = true;
    releaseUploads();
    left?.dispose?.();
    return left;
  }

  // --- state from the controls

  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (input instanceof HTMLTextAreaElement) {
      const t = state.texts[Number(input.dataset.index)];
      if (!t) return;
      t.text = input.value;
      select({ kind: 'text', index: Number(input.dataset.index) });
      changed();
      return;
    }
    const { name, value } = input;
    const checked = input instanceof HTMLInputElement && input.checked;
    const t = selectedText();
    const image = selectedImage();
    switch (name) {
      case 'top':
      case 'right':
      case 'bottom':
      case 'left':
        state.pad[name] = clampField('pad', Number(value));
        setRange(name, state.pad[name]);
        break;
      case 'padColor':
        state.padColor = normalizeColor(value) ?? state.padColor;
        break;
      case 'imageSize':
        if (!image) return;
        image.w = clampField('w', Number(value));
        setRange(name, image.w);
        break;
      case 'imageRotation':
        if (!image) return;
        image.rotation = clampField('rotation', Number(value));
        setRange(name, image.rotation);
        break;
      case 'flip':
        if (!image) return;
        image.flip = checked;
        break;
      case 'zoom': {
        const at = selectedPanel();
        if (at !== null) zoomPanel(at, Number(value));
        return;
      }
      case 'style':
        if (!t || !Object.hasOwn(STYLES, value)) return;
        Object.assign(t, STYLES[value as keyof typeof STYLES].style);
        break;
      case 'font':
        if (!t || !Object.hasOwn(FONTS, value)) return;
        t.font = value as TextLayer['font'];
        break;
      case 'size':
      case 'outlineWidth':
      case 'rotation':
        if (!t) return;
        t[name] = clampField(name, Number(value));
        break;
      case 'color':
      case 'outline':
        if (!t) return;
        t[name] = normalizeColor(value) ?? t[name];
        break;
      case 'align':
        if (!t || !Object.hasOwn(ALIGNS, value)) return;
        t.align = value as TextLayer['align'];
        break;
      case 'valign':
        if (!t || !Object.hasOwn(VALIGNS, value)) return;
        t.valign = value as TextLayer['valign'];
        break;
      case 'caps':
      case 'bold':
        if (!t) return;
        t[name] = checked;
        break;
      default:
        return; // the width is typed: it's applied on change
    }
    // A text's controls depend on each other: the style on the others, bold on the font.
    if (t) syncSelection();
    changed();
  });
  form.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.name !== 'width') return;
    const n = Number(input.value);
    state.width = input.value.trim() && Number.isFinite(n) && n > 0 ? clampField('width', n) : 0;
    input.value = state.width ? String(state.width) : '';
    done();
  });

  // A text is selected by going to its field, which may be in focus already.
  for (const type of ['focusin', 'pointerdown'] as const) {
    textList.addEventListener(type, (e) => {
      const input = e.target;
      if (input instanceof HTMLTextAreaElement) select({ kind: 'text', index: Number(input.dataset.index) });
    });
  }
  textList.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLElement>('button[data-remove]');
    if (button) remove({ kind: 'text', index: Number(button.dataset.remove) });
  });

  $('addText').addEventListener('click', () => {
    // In the style of the text at hand, in the middle of the picture or of the selected panel.
    const like = selectedText() ?? state.texts.at(-1) ?? TEXT_DEFAULT;
    const panel = panelAtHand();
    const at = panel && {
      x: clampField('x', panel.x + panel.w / 2),
      y: clampField('y', panel.y + panel.h / 2),
      w: clampField('w', panel.w * 0.94),
      h: clampField('h', Math.min(panel.h * 0.4, TEXT_DEFAULT.h)),
    };
    addText({ ...TEXT_DEFAULT, ...styleOf(like), size: like.size, ...at });
  });
  $('addCaption').addEventListener('click', () => {
    if (state.texts.length >= MAX_LAYERS) return;
    const { texts, pad } = withCaption(state);
    state.pad = pad;
    addText(texts.at(-1)!);
  });
  $('duplicateText').addEventListener('click', () => {
    const t = selectedText();
    if (t) addText(shifted(t));
  });
  $('styleAll').addEventListener('click', () => {
    const t = selectedText();
    if (!t) return;
    for (const other of state.texts) Object.assign(other, styleOf(t), { size: t.size });
    done();
  });
  $('duplicateImage').addEventListener('click', () => {
    const image = selectedImage();
    if (!image || state.images.length >= MAX_LAYERS) return;
    state.images.push(shifted(image));
    select({ kind: 'image', index: state.images.length - 1 });
    done();
  });
  $('removeSticker').addEventListener('click', () => {
    if (selected?.kind === 'image') remove(selected);
  });

  stickers.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLElement>('button[data-id]');
    const t = button && byId.get(button.dataset.id!);
    if (t) addImage(t.id, t);
  });
  function filterLibrary(list: HTMLElement, query: string): void {
    const words = searchWords(query);
    for (const li of list.children) {
      if (li instanceof HTMLElement) li.hidden = !words.every((w) => li.dataset.name!.includes(w));
    }
  }
  stickerSearch.addEventListener('input', () => filterLibrary(stickers, stickerSearch.value));
  $('stickerUpload').addEventListener('click', () => stickerFile.click());

  panelList.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLElement>('button[data-panel]');
    if (button) select({ kind: 'panel', index: Number(button.dataset.panel) });
  });
  panelLibrary.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLElement>('button[data-id]');
    if (button && byId.has(button.dataset.id!)) fillPanel(targetPanel(), button.dataset.id!);
  });
  panelSearch.addEventListener('input', () => filterLibrary(panelLibrary, panelSearch.value));
  $('panelUpload').addEventListener('click', () => panelFile.click());
  panelFile.addEventListener('change', () => {
    upload(panelFile.files ?? [], targetPanel());
    panelFile.value = '';
  });
  // The whole picture in the panel, or the panel covered.
  $('panelFit').addEventListener('click', () => {
    const at = selectedPanel();
    const fill = at === null ? undefined : fillOf(at);
    const size = fill && sizeOf(fill.image);
    const panel = at === null ? undefined : panels()[at];
    const into = panel && panelSize(panel);
    if (at === null || !size || !into) return;
    zoomPanel(at, fitZoom(size, into));
    commit();
  });
  $('panelCover').addEventListener('click', () => {
    const at = selectedPanel();
    if (at === null) return;
    zoomPanel(at, 1);
    commit();
  });
  $('panelEmpty').addEventListener('click', () => {
    const at = selectedPanel();
    if (at !== null) emptyPanel(at);
  });
  stickerFile.addEventListener('change', () => {
    upload(stickerFile.files ?? []);
    stickerFile.value = '';
  });
  stage.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dropHint.hidden = false;
  });
  stage.addEventListener('dragleave', (e) => {
    if (!stage.contains(e.relatedTarget as Node | null)) dropHint.hidden = true;
  });
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    dropHint.hidden = true;
    // Onto a panel, it fills it.
    const panel = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('panel'));
    upload(e.dataTransfer?.files ?? [], panel ? Number(panel.dataset.index) : undefined);
  });
  // Before the background editor, which may be open underneath, gets it.
  document.addEventListener(
    'paste',
    (e) => {
      if (!dialog.open) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      // Into the selected panel, if one is.
      upload(files, selectedPanel() ?? undefined);
    },
    true,
  );

  // --- result

  async function toBlob(): Promise<Blob> {
    const of = base;
    if (!of || !picture) throw new Error('no picture');
    // What the preview is still waiting for would be missing from the result.
    const images = [...state.images, ...state.fills].flatMap(({ image }) => sourceOf(image) ?? []);
    await Promise.all([loadFonts(), ...images.map(load)]);
    if (base !== of) throw new Error('no picture');
    render();
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no picture'))), 'image/png');
    });
  }

  // Says how it went on the button itself, for a moment.
  function flash(button: HTMLButtonElement, text: string): void {
    const label = (button.dataset.label ??= button.textContent ?? '');
    button.textContent = text;
    setTimeout(() => (button.textContent = label), 1500);
  }

  downloadButton.addEventListener('click', () => {
    const name = `${base?.link ? base.link.id.split('/').pop() : 'custom'}-meme.png`;
    toBlob().then(
      (blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      },
      () => flash(downloadButton, 'Could not save'),
    );
  });
  copyButton.addEventListener('click', () => {
    // The picture is handed over as a promise: some browsers only take it that way.
    navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob() })]).then(
      () => flash(copyButton, 'Copied'),
      () => flash(copyButton, 'Could not copy'),
    );
  });
  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  $('memeReset').addEventListener('click', () => {
    state = blank(layout);
    selected = null;
    sync();
    done();
  });
  $('memeClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    const closed = leave();
    if (closed) onClose(closed);
  });

  // --- dragging on the preview: a layer, one of its corners or its rotation handle, or a panel's picture

  function pointOf(e: PointerEvent, f: Frame): Point {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * f.width,
      y: ((e.clientY - r.top) / r.height) * f.height,
    };
  }

  // Layers overlap: the smallest one under the pointer is the one meant, or a
  // text over the whole picture would keep everything under it out of reach.
  function layerAt(e: MouseEvent): HTMLElement | null {
    const handle = (e.target as Element).closest<HTMLElement>('.handle');
    if (handle) return handle.parentElement;
    const area = (el: HTMLElement) => el.offsetWidth * el.offsetHeight;
    return document
      .elementsFromPoint(e.clientX, e.clientY)
      .filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('layer'))
      .reduce<HTMLElement | null>((best, el) => (best && area(best) <= area(el) ? best : el), null);
  }

  const refOf = (el: HTMLElement): LayerSelection => ({
    kind: el.dataset.kind === 'image' ? 'image' : 'text',
    index: Number(el.dataset.index),
  });

  const panelOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('.panel') : null;

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !frame || (e.target as Element).closest('button')) return;
    const el = layerAt(e);
    const panelEl = !el && panelOf(e.target);
    if (panelEl) {
      // A panel is selected, and its picture dragged.
      const index = Number(panelEl.dataset.index);
      e.preventDefault();
      select({ kind: 'panel', index });
      panelEl.focus({ preventScroll: true });
      const fill = fillOf(index);
      if (!fill) return;
      panelEl.setPointerCapture(e.pointerId);
      wrap.classList.add('dragging');
      drag = { mode: 'pan', start: pointOf(e, frame), origin: { x: fill.x, y: fill.y } };
      return;
    }
    if (!el) {
      select(null);
      const active = document.activeElement;
      if (active instanceof HTMLElement && (layers.contains(active) || panelBoxes.contains(active)))
        active.blur();
      return;
    }
    const ref = refOf(el);
    const layer = layerOf(ref);
    const box = boxOf(ref);
    if (!layer || !box) return;
    e.preventDefault();
    select(ref);
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    wrap.classList.add('dragging');

    const p = pointOf(e, frame);
    const origin = place(box, frame);
    const handle = (e.target as Element).closest<HTMLElement>('.handle');
    if (handle?.dataset.rotate !== undefined) {
      drag = { mode: 'rotate', centre: { x: origin.cx, y: origin.cy } };
    } else if (handle?.dataset.corner) {
      const corner = handle.dataset.corner.split(',').map(Number) as unknown as Corner;
      const [sx, sy] = corner;
      const cos = Math.cos(origin.angle);
      const sin = Math.sin(origin.angle);
      // From the pointer to the corner itself, so that it doesn't jump to the pointer.
      const grab = {
        x: origin.cx + ((sx * origin.width) / 2) * cos - ((sy * origin.height) / 2) * sin - p.x,
        y: origin.cy + ((sx * origin.width) / 2) * sin + ((sy * origin.height) / 2) * cos - p.y,
      };
      const ratio = ref.kind === 'image' ? origin.width / origin.height : undefined;
      drag = { mode: 'resize', corner, origin, grab, ratio };
    } else {
      drag = { mode: 'move', start: p, origin: { x: layer.x, y: layer.y } };
    }
  });

  /** The middle of the picture or of a panel nearest to a value, along an axis, if it's close enough. */
  function middleNear(axis: 'x' | 'y', value: number): number | null {
    const middles = [50, ...panels().map((p) => (axis === 'x' ? p.x + p.w / 2 : p.y + p.h / 2))];
    let best: number | null = null;
    for (const m of middles) {
      if (Math.abs(value - m) <= SNAP && (best === null || Math.abs(value - m) < Math.abs(value - best)))
        best = m;
    }
    return best;
  }

  stage.addEventListener('pointermove', (e) => {
    if (!drag || !frame || !selected) return;
    const p = pointOf(e, frame);
    if (drag.mode === 'pan') {
      if (selected.kind !== 'panel') return;
      panPanel(selected.index, drag.origin, p.x - drag.start.x, p.y - drag.start.y);
      draw();
      return;
    }
    const layer = layerOf(selected);
    if (!layer || selected.kind === 'panel') return;
    const { image } = frame;
    let onX: number | null = null;
    let onY: number | null = null;
    if (drag.mode === 'move') {
      const x = drag.origin.x + ((p.x - drag.start.x) / image.width) * 100;
      const y = drag.origin.y + ((p.y - drag.start.y) / image.height) * 100;
      // It snaps to the middle of the picture and of the panels. Alt lets it go anywhere.
      onX = e.altKey ? null : middleNear('x', x);
      onY = e.altKey ? null : middleNear('y', y);
      layer.x = clampField('x', onX ?? x);
      layer.y = clampField('y', onY ?? y);
      guides.x.style.left = `${((image.x + ((onX ?? 0) / 100) * image.width) / frame.width) * 100}%`;
      guides.y.style.top = `${((image.y + ((onY ?? 0) / 100) * image.height) / frame.height) * 100}%`;
    } else if (drag.mode === 'resize') {
      const to = { x: p.x + drag.grab.x, y: p.y + drag.grab.y };
      const range = sizeRange(frame, selected.kind);
      const box = unplace(resize(drag.origin, drag.corner, to, { ...range, ratio: drag.ratio }), frame);
      layer.x = box.x;
      layer.y = box.y;
      layer.w = box.w;
      if ('h' in layer) layer.h = box.h;
    } else {
      const angle = rotationTo(drag.centre, p);
      // Shift turns it by steps.
      layer.rotation = clampField(
        'rotation',
        e.shiftKey ? snap(angle, 15, 15) : e.altKey ? angle : snap(angle, SNAP_ANGLES, SNAP_ANGLE),
      );
    }
    guides.x.hidden = onX === null;
    guides.y.hidden = onY === null;
    syncSelection();
    draw();
  });

  // The wheel zooms a panel's picture. Its zoom is kept unrounded here, for
  // the small steps of a touchpad to add up.
  let wheelZoom = 1;
  stage.addEventListener(
    'wheel',
    (e) => {
      const panelEl = !layerAt(e) && panelOf(e.target);
      const index = panelEl ? Number(panelEl.dataset.index) : -1;
      const fill = fillOf(index);
      if (!fill || drag) return;
      e.preventDefault();
      select({ kind: 'panel', index });
      const lines = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY / 100 : e.deltaY / 3;
      if (Math.abs(wheelZoom - fill.zoom) > LIMITS.zoom.step) wheelZoom = fill.zoom;
      const { min, max } = LIMITS.zoom;
      wheelZoom = Math.min(max, Math.max(min, wheelZoom * WHEEL_ZOOM ** -lines));
      zoomPanel(index, wheelZoom);
    },
    { passive: false },
  );

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    wrap.classList.remove('dragging');
    guides.x.hidden = guides.y.hidden = true;
    commit();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  layers.addEventListener('dblclick', () => {
    if (selected?.kind === 'text') editText(selected.index);
  });
  layers.addEventListener('focusin', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.layer');
    if (el && !drag) select(refOf(el));
  });
  panelBoxes.addEventListener('focusin', (e) => {
    const el = panelOf(e.target);
    if (el && !drag) select({ kind: 'panel', index: Number(el.dataset.index) });
  });

  dialog.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // A field that isn't part of the design has its own undo.
    const apart =
      e.target instanceof HTMLInputElement && ['search', 'text', 'number'].includes(e.target.type);
    if (mod && !e.altKey && !apart && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    // The rest is for the layer or panel in focus.
    const step = e.shiftKey ? 5 : 0.5;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (selected?.kind === 'panel' && panelOf(e.target)) {
      const fill = fillOf(selected.index);
      const panel = panels()[selected.index];
      if (move && fill && frame && panel) {
        // Its picture moves by a share of the panel.
        e.preventDefault();
        const r = panelRect(panel, frame);
        panPanel(selected.index, fill, (move[0] / 100) * r.width, (move[1] / 100) * r.height);
        changed();
      } else if (fill && (e.key === '+' || e.key === '=' || e.key === '-')) {
        e.preventDefault();
        zoomPanel(selected.index, fill.zoom + (e.key === '-' ? -0.1 : 0.1));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        emptyPanel(selected.index);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        panelSearch.focus();
      }
      return;
    }
    const layer = selected && layerOf(selected);
    if (!selected || !layer || !(e.target as Element).closest('.layer')) return;
    if (move && e.altKey) {
      // Alt resizes it, about its middle: an image as a whole, a text's box each way.
      e.preventDefault();
      const across = move[0] * 2;
      const down = move[1] * 2;
      if ('h' in layer) {
        layer.w = clampField('w', layer.w + across);
        layer.h = clampField('h', layer.h + down);
      } else {
        layer.w = clampField('w', layer.w + across + down);
      }
      syncSelection();
      changed();
    } else if (move) {
      e.preventDefault();
      layer.x = clampField('x', layer.x + move[0]);
      layer.y = clampField('y', layer.y + move[1]);
      changed();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(selected);
    } else if (selected.kind === 'text' && e.key === 'Enter') {
      e.preventDefault();
      editText(selected.index);
    } else if (selected.kind === 'text' && e.key.length === 1 && !mod && !e.altKey) {
      // Typing on a text goes to it: the key lands in its field, now in focus.
      editText(selected.index);
    }
  });

  // A template to pick, found by its names.
  function libraryItem(t: Template): HTMLLIElement {
    const li = document.createElement('li');
    li.dataset.name = fold([t.name, ...t.aliases].join(' '));
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.id = t.id;
    button.title = t.name;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = t.name;
    img.src = thumbUrl(t);
    button.append(img);
    li.append(button);
    return li;
  }

  return {
    open(next, params) {
      // Straight from another picture, when the hash goes from one to the next.
      leave();
      base = next;
      selected = null;
      // A duplicate's file may not be laid out like the template's.
      layout = next.link && !next.link.file ? layoutOf(next.link.id) : undefined;
      const draft = next.link && drafts.get(next.src);
      state = params?.size ? decode(params, layout) : draft ? (JSON.parse(draft) as Meme) : blank(layout);
      // Images that aren't in the library (any more) can't be shown.
      state.images = state.images.filter((layer) => sourceOf(layer.image));
      state.fills = state.fills.filter((fill) => sourceOf(fill.image));
      steps = createHistory(JSON.stringify(state));
      $('memeName').textContent = next.name;
      meta.textContent = 'Loading…';
      wrap.hidden = true;
      sync();
      if (!dialog.open) dialog.showModal();
      commit();
      loadFonts();
      // Ready to type the first text.
      if (state.texts.length) editText(0);

      const img = new Image();
      img.onload = () => {
        if (base !== next) return;
        picture = img;
        wrap.hidden = false;
        downloadButton.disabled = copyButton.disabled = false;
        render();
      };
      img.onerror = () => {
        if (base === next) meta.textContent = 'Could not load the picture.';
      };
      img.src = next.src;
    },
    close() {
      dialog.close();
    },
    get isOpen() {
      return dialog.open;
    },
    download() {
      if (!downloadButton.disabled) downloadButton.click();
    },
    copy() {
      if (copyButton.hidden || copyButton.disabled) return false;
      copyButton.click();
      return true;
    },
    focusSearch() {
      if (stickerSearch.hidden) return;
      stickerSearch.scrollIntoView({ block: 'nearest' });
      stickerSearch.select();
    },
    setLibrary(templates) {
      byId = new Map(templates.map((t) => [t.id, t]));
      const characters = templates.filter((t) => categoryOf(t) === 'characters');
      stickers.replaceChildren(...characters.map(libraryItem));
      stickersEmpty.hidden = characters.length > 0;
      stickerSearch.hidden = characters.length === 0;
      // The panels take complete memes, most popular first.
      const complete = templates.filter((t) => categoryOf(t) === 'complete').sort((a, b) => a.rank - b.rank);
      panelLibrary.replaceChildren(...complete.map(libraryItem));
      filterLibrary(panelLibrary, panelSearch.value);
      renderPanels();
      syncSelection();
      draw();
    },
  };
}
