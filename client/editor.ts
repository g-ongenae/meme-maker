// Background editor: a dialog with a live preview of a custom background (see
// background.ts) and its controls, with an image on top: a library template
// (the characters) or one the user uploads. The design is kept in the URL hash
// (#editor?…) so it can be bookmarked or shared; uploaded images stay local.

import {
  type Background,
  type NumberField,
  type Point,
  type Style,
  DEFAULT,
  LIMITS,
  MAX_COLORS,
  PATTERNS,
  PRESETS,
  SPLITS,
  applyPreset,
  clampField,
  decode,
  encode,
  imageRect,
  normalizeColor,
  paint,
} from './background.ts';
import { type Category, categoryOf } from './categories.ts';
import { $ } from './dom.ts';
import { type Template, imgUrl, thumbUrl } from './templates.ts';

// Library images offered to put on top: the characters cut out of templates.
const LIBRARY: Category = 'characters';

// Colours offered when adding one to a palette, the first not in it yet.
const SUGGESTED = ['#ffffff', '#000000', '#ee1122', '#ffcc11', '#11bbbb', '#2d4fa3', '#ff8a92', '#449a3a'];

export const isEditorHash = (hash: string): boolean => hash === '#editor' || hash.startsWith('#editor?');

const isNumberField = (name: string): name is NumberField => Object.hasOwn(LIMITS, name);

export interface Editor {
  /** Opens the editor on the design in the hash's parameters. */
  open(params: URLSearchParams): void;
  close(): void;
  readonly isOpen: boolean;
  /** Templates the image on top can be picked from, once loaded. */
  setLibrary(templates: Template[]): void;
}

export function createEditor({ onClose }: { onClose(): void }): Editor {
  const dialog = $<HTMLDialogElement>('editor');
  const stage = $('editorStage');
  const wrap = $('editorCanvas');
  const canvas = $<HTMLCanvasElement>('canvas');
  const ctx = canvas.getContext('2d')!;
  const handle = $<HTMLButtonElement>('centreHandle');
  const form = $<HTMLFormElement>('editorForm');
  const preset = $<HTMLSelectElement>('preset');
  const patterns = $('patterns');
  const palettes = { colors: $('colors'), colors2: $('colors2') };
  const libraryList = $<HTMLUListElement>('library');
  const libraryEmpty = $('libraryEmpty');
  const upload = $<HTMLInputElement>('upload');
  const dropHint = $('dropHint');
  const meta = $('editorMeta');

  let state: Background = { ...DEFAULT };
  let uploaded: string | null = null; // object URL of an uploaded image, which wins over state.image
  let picture: HTMLImageElement | null = null; // the image on top, once loaded
  let pictureSrc = '';
  let library: Template[] = [];
  let byId = new Map<string, Template>();

  // --- static controls

  for (const [field, { min, max, step }] of Object.entries(LIMITS)) {
    const input = form.elements.namedItem(field);
    if (input instanceof HTMLInputElement) Object.assign(input, { min, max, step });
  }
  for (const [key, { name }] of Object.entries(PRESETS)) preset.append(new Option(name, key));
  const split = form.elements.namedItem('split') as HTMLSelectElement;
  for (const [key, label] of Object.entries(SPLITS)) split.append(new Option(label, key));
  for (const [key, label] of Object.entries(PATTERNS)) {
    const option = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'pattern';
    radio.value = key;
    option.append(radio, label);
    patterns.append(option);
  }

  // --- drawing

  const pictureSource = (): string => {
    if (uploaded) return uploaded;
    const t = byId.get(state.image);
    return t && !t.animated ? imgUrl(t) : '';
  };

  function loadPicture(): void {
    const src = pictureSource();
    if (src === pictureSrc) return;
    pictureSrc = src;
    picture = null;
    if (src) {
      const img = new Image();
      img.onload = () => {
        if (pictureSrc !== src) return;
        picture = img;
        draw();
      };
      img.onerror = () => {
        if (pictureSrc === src) meta.textContent = 'Could not load the image.';
      };
      img.src = src;
    }
    syncImage();
    draw();
  }

  let frame = 0;
  function draw(): void {
    frame ||= requestAnimationFrame(render);
  }

  function render(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    const { width, height } = state;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    wrap.style.setProperty('--ratio', `${width} / ${height}`);
    wrap.style.setProperty('--aspect', String(width / height));
    paint(ctx, state);
    if (picture) {
      const r = imageRect(state, { width: picture.naturalWidth, height: picture.naturalHeight });
      ctx.save();
      if (state.halo > 0) {
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = (state.halo / 100) * 0.08 * Math.min(width, height);
        // Twice, for a halo as bright as the templates'.
        ctx.drawImage(picture, r.x, r.y, r.width, r.height);
      }
      ctx.drawImage(picture, r.x, r.y, r.width, r.height);
      ctx.restore();
    }
    handle.style.left = `${state.cx}%`;
    handle.style.top = `${state.cy}%`;
    handle.hidden = state.pattern === 'solid';
    meta.textContent = `${width} × ${height} px · PNG`;
  }

  // The design goes to the URL, but not on every slider step: browsers limit
  // how often history can be replaced.
  let saveTimer = 0;
  function save(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!dialog.open) return;
      const query = encode(state).toString();
      history.replaceState(
        null,
        '',
        `${location.pathname}${location.search}#editor${query ? `?${query}` : ''}`,
      );
    }, 300);
  }

  function changed(): void {
    draw();
    save();
  }

  // --- controls from the state

  function syncField(field: NumberField): void {
    const input = form.elements.namedItem(field);
    if (!(input instanceof HTMLInputElement)) return;
    input.value = String(state[field]);
    const output = input.nextElementSibling;
    if (output instanceof HTMLOutputElement)
      output.textContent = `${state[field]}${input.dataset.unit ?? ''}`;
  }

  function renderPalette(field: 'colors' | 'colors2'): void {
    const colors = state[field];
    const max = state.pattern === 'solid' && field === 'colors' ? 1 : MAX_COLORS;
    const shown = colors.slice(0, max);
    const swatches = shown.map((color, i) => {
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      const input = document.createElement('input');
      input.type = 'color';
      input.value = color;
      input.dataset.index = String(i);
      input.ariaLabel = `Colour ${i + 1}`;
      swatch.append(input);
      if (shown.length > 1) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.dataset.remove = String(i);
        remove.ariaLabel = `Remove colour ${i + 1}`;
        remove.title = 'Remove';
        remove.textContent = '✕';
        swatch.append(remove);
      }
      return swatch;
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add';
    add.dataset.add = '';
    add.ariaLabel = 'Add a colour';
    add.title = 'Add a colour';
    add.textContent = '+';
    add.hidden = colors.length >= max;
    palettes[field].replaceChildren(...swatches, add);
  }

  function syncImage(): void {
    const has = !!pictureSrc;
    for (const el of form.querySelectorAll<HTMLElement>('[data-image]')) el.hidden = !has;
    for (const button of libraryList.querySelectorAll<HTMLElement>('button[data-id]')) {
      button.ariaPressed = String(!uploaded && button.dataset.id === state.image);
    }
  }

  function sync(): void {
    for (const field of Object.keys(LIMITS) as NumberField[]) syncField(field);
    for (const radio of patterns.querySelectorAll('input')) radio.checked = radio.value === state.pattern;
    split.value = state.split;
    (form.elements.namedItem('lineColor') as HTMLInputElement).value = state.lineColor;
    for (const el of form.querySelectorAll<HTMLElement>('[data-patterns]')) {
      el.hidden = !el.dataset.patterns!.split(' ').includes(state.pattern);
    }
    const [first, second] = state.split === 'horizontal' ? ['Top', 'Bottom'] : ['Left', 'Right'];
    $('colorsLabel').textContent = {
      sunburst: 'Colours',
      glow: 'Colours, from the centre out',
      split: `${first} colours`,
      solid: 'Colour',
    }[state.pattern];
    $('colors2Label').textContent = `${second} colours`;
    $('slicesLabel').textContent = state.pattern === 'glow' ? 'Rays' : 'Slices';
    renderPalette('colors');
    renderPalette('colors2');
    syncImage();
  }

  // --- state from the controls

  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement | HTMLSelectElement;
    const { name, value } = input;
    if (isNumberField(name)) {
      // Sizes are typed: they're applied on change, not at each keystroke.
      if (input.type === 'number') return;
      state[name] = clampField(name, Number(value));
      syncField(name);
    } else if (name === 'pattern') {
      state.pattern = value as Background['pattern'];
      sync();
    } else if (name === 'split') {
      state.split = value as Background['split'];
      sync();
    } else if (name === 'lineColor') {
      state.lineColor = normalizeColor(value) ?? state.lineColor;
    } else if (input.dataset.index) {
      const field = input.closest('#colors2') ? 'colors2' : 'colors';
      state[field][Number(input.dataset.index)] = normalizeColor(value) ?? state[field][0];
    } else {
      return;
    }
    changed();
  });
  form.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.type !== 'number' || !isNumberField(input.name)) return;
    const n = Number(input.value);
    if (input.value.trim() && Number.isFinite(n)) state[input.name] = clampField(input.name, n);
    syncField(input.name);
    changed();
  });

  for (const field of ['colors', 'colors2'] as const) {
    palettes[field].addEventListener('click', (e) => {
      const button = (e.target as Element).closest('button');
      if (!button) return;
      const colors = [...state[field]];
      if (button.dataset.remove) colors.splice(Number(button.dataset.remove), 1);
      else if (button.dataset.add !== undefined && colors.length < MAX_COLORS) {
        colors.push(SUGGESTED.find((c) => !colors.includes(c)) ?? '#808080');
      } else return;
      state[field] = colors;
      renderPalette(field);
      changed();
    });
  }

  preset.addEventListener('change', () => {
    const style: Partial<Style> | undefined = PRESETS[preset.value]?.style;
    preset.value = '';
    if (!style) return;
    state = applyPreset(state, style);
    sync();
    changed();
  });

  $('shuffle').addEventListener('click', () => {
    state.seed = Math.floor(Math.random() * LIMITS.seed.max);
    if (!state.irregularity) state.irregularity = 40;
    syncField('irregularity');
    changed();
  });

  $('editorReset').addEventListener('click', () => {
    state = { ...DEFAULT, image: state.image };
    sync();
    changed();
  });

  $('editorDownload').addEventListener('click', () => {
    render();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `background-${state.width}x${state.height}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }, 'image/png');
  });

  $('editorClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    clearTimeout(saveTimer);
    onClose();
  });

  // --- image on top

  function useUpload(file: File | undefined): void {
    if (!file?.type.startsWith('image/')) return;
    if (uploaded) URL.revokeObjectURL(uploaded);
    uploaded = URL.createObjectURL(file);
    state.image = '';
    loadPicture();
    save();
  }

  libraryList.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLElement>('button[data-id]');
    if (!button) return;
    if (uploaded) URL.revokeObjectURL(uploaded);
    uploaded = null;
    state.image = button.dataset.id!;
    loadPicture();
    save();
  });
  $('uploadButton').addEventListener('click', () => upload.click());
  upload.addEventListener('change', () => {
    useUpload(upload.files?.[0]);
    upload.value = '';
  });
  $('removeImage').addEventListener('click', () => {
    if (uploaded) URL.revokeObjectURL(uploaded);
    uploaded = null;
    state.image = '';
    loadPicture();
    save();
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
    useUpload(e.dataTransfer?.files[0]);
  });
  document.addEventListener('paste', (e) => {
    if (!dialog.open) return;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    useUpload(file);
  });

  // --- dragging on the preview: the image when on it, the centre otherwise

  let drag: { image: false } | { image: true; dx: number; dy: number } | null = null;

  function toPercent(e: PointerEvent): Point {
    const r = canvas.getBoundingClientRect();
    const clamp = (v: number) => Math.min(100, Math.max(0, v));
    return {
      x: clamp(((e.clientX - r.left) / r.width) * 100),
      y: clamp(((e.clientY - r.top) / r.height) * 100),
    };
  }

  function onPicture(p: Point): boolean {
    if (!picture) return false;
    const r = imageRect(state, { width: picture.naturalWidth, height: picture.naturalHeight });
    const x = (p.x / 100) * state.width;
    const y = (p.y / 100) * state.height;
    return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
  }

  function moveTo(p: Point): void {
    if (!drag) return;
    const [fx, fy] = drag.image ? (['ix', 'iy'] as const) : (['cx', 'cy'] as const);
    state[fx] = clampField(fx, drag.image ? p.x + drag.dx : p.x);
    state[fy] = clampField(fy, drag.image ? p.y + drag.dy : p.y);
    syncField(fx);
    syncField(fy);
    draw();
  }

  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = toPercent(e);
    if (e.target !== handle && onPicture(p)) drag = { image: true, dx: state.ix - p.x, dy: state.iy - p.y };
    else if (state.pattern !== 'solid') drag = { image: false };
    else return;
    e.preventDefault();
    if (e.target === handle) handle.focus();
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('dragging');
    moveTo(p);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (drag) moveTo(toPercent(e));
    else wrap.classList.toggle('over-image', onPicture(toPercent(e)));
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    wrap.classList.remove('dragging');
    save();
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    state.cx = clampField('cx', state.cx + move[0]);
    state.cy = clampField('cy', state.cy + move[1]);
    syncField('cx');
    syncField('cy');
    changed();
  });

  return {
    open(params) {
      state = decode(params);
      // An uploaded image stays on show unless the design names one.
      if (state.image && uploaded) {
        URL.revokeObjectURL(uploaded);
        uploaded = null;
      }
      sync();
      loadPicture();
      render();
      if (!dialog.open) dialog.showModal();
    },
    close() {
      dialog.close();
    },
    get isOpen() {
      return dialog.open;
    },
    setLibrary(templates) {
      byId = new Map(templates.map((t) => [t.id, t]));
      library = templates.filter((t) => categoryOf(t) === LIBRARY);
      libraryList.replaceChildren(
        ...library.map((t) => {
          const li = document.createElement('li');
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
        }),
      );
      libraryEmpty.hidden = library.length > 0;
      loadPicture();
    },
  };
}
