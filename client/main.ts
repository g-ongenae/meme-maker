// Template browser: grid with search, category filter and sort, plus a viewer
// dialog with a side panel of alternatives: the template's other formats (the
// duplicates merged into it) and its variations (related templates, and the
// characters cut out of it). Characters are listed as templates of their own.
// Diagrams aren't templates but open in the same viewer: rendered by
// mermaid.ink, with their formats (themes, looks) as alternatives, and a link
// to edit them in the Mermaid live editor. "Edit" opens the template on show
// in the meme editor, over the viewer.

import { type Category, CATEGORIES, categoryOf, isCategory } from './categories.ts';
import { type Character, withCharacters } from './characters.ts';
import {
  type Diagram,
  type DiagramFormat,
  type Pictures,
  DIAGRAMS,
  FORMATS,
  editorUrl,
  pictureUrls,
} from './diagrams.ts';
import { $ } from './dom.ts';
import { createEditor, isEditorHash } from './editor.ts';
import { createHelp } from './help.ts';
import { editHash, parseEditHash } from './meme.ts';
import { createMemeEditor } from './meme-editor.ts';
import { GO_DELAY, goToCategory } from './shortcuts.ts';
import {
  type Duplicate,
  type SearchKeys,
  type SortKey,
  type Template,
  SORTS,
  fold,
  gifMakerUrl,
  imgUrl,
  isSortKey,
  kymUrl,
  match,
  searchKeys,
  searchWords,
  stillUrl,
  thumbUrl,
} from './templates.ts';

const header = document.querySelector('header')!;
const grid = $<HTMLUListElement>('grid');
const empty = $<HTMLParagraphElement>('empty');
const count = $('count');
const search = $<HTMLInputElement>('search');
const category = $<HTMLSelectElement>('category');
const sort = $<HTMLSelectElement>('sort');
const viewer = $<HTMLDialogElement>('viewer');
const big = $<HTMLImageElement>('big');
const bigVideo = $<HTMLVideoElement>('bigVideo');
const prev = $<HTMLButtonElement>('prev');
const next = $<HTMLButtonElement>('next');
const aliasesEl = $<HTMLParagraphElement>('aliases');
const editLink = $<HTMLAnchorElement>('edit');
const openLink = $<HTMLAnchorElement>('open');
const downloadLink = $<HTMLAnchorElement>('download');
const sourceLink = $<HTMLAnchorElement>('source');
const kymLink = $<HTMLAnchorElement>('kym');
const gifMakerLink = $<HTMLAnchorElement>('gifMaker');
const related = $('related');
const relatedToggle = $<HTMLButtonElement>('relatedToggle');
const relatedCount = $('relatedCount');
const showDuplicates = $<HTMLInputElement>('showDuplicates');
const formats = $('formats');
const formatList = $<HTMLUListElement>('formatList');
const variations = $('variations');
const variationList = $<HTMLUListElement>('variationList');
const relatedEmpty = $('relatedEmpty');
// The meme editor opens over the viewer, or over the background editor for a
// background made there: closing it goes back to what's underneath.
const memeEditor = createMemeEditor({
  onClose: (base) => {
    if (base.link && parseEditHash(location.hash)) setHash(viewer.open && current ? current.id : '');
  },
});
const editor = createEditor({
  onClose: () => {
    if (isEditorHash(location.hash)) setHash('');
  },
  onCaption: (picture) => openLocal('Custom background', picture),
});
const importImage = $<HTMLInputElement>('importImage');

function openLocal(name: string, picture: Blob): void {
  const src = URL.createObjectURL(picture);
  memeEditor.open({ name, src, dispose: () => URL.revokeObjectURL(src) });
}

// A picture of the user's own, made into a meme like a template.
function createFrom(file: File | undefined): boolean {
  if (!file?.type.startsWith('image/')) return false;
  openLocal(file.name.replace(/\.[^.]*$/, '') || 'Imported image', file);
  return true;
}
const anyOpen = (): boolean => viewer.open || editor.isOpen || memeEditor.isOpen || help.isOpen;
const help = createHelp();

// Viewer preferences, remembered across visits (storage can be unavailable).
const prefs = {
  get(key: string, fallback: boolean): boolean {
    try {
      const v = localStorage.getItem(`meme-maker.${key}`);
      return v === null ? fallback : v === '1';
    } catch {
      return fallback;
    }
  },
  set(key: string, value: boolean): void {
    try {
      localStorage.setItem(`meme-maker.${key}`, value ? '1' : '0');
    } catch {
      // not persisted
    }
  },
};
let panelOpen = prefs.get('alternatives', true);
showDuplicates.checked = prefs.get('duplicates', true);

const fmt = new Intl.NumberFormat('en');

interface Card {
  id: string;
  template: Template;
  el: HTMLLIElement;
  aka: HTMLSpanElement;
  keys: SearchKeys;
  category: Category;
}

let cards: Card[] = [];
let templatesMissing = false;
let byId = new Map<string, Card>();
let visible: Entry[] = []; // cards currently shown, in display order
let current: Entry | null = null; // card open in the viewer
let shown: Duplicate | null = null; // file shown in the viewer: the template's or a duplicate's
let shownFormat: DiagramFormat | null = null; // format of the diagram shown in the viewer

function buildCard(t: Template): Card {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `#${t.id}`;
  a.title = t.name;

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.src = thumbUrl(t);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = t.name;

  const aka = document.createElement('span');
  aka.className = 'aka';
  aka.hidden = true;

  a.append(img);
  const badge = t.animated
    ? ['GIF', 'Animated template']
    : t.cutFrom
      ? ['Character', 'Cut out of a template']
      : null;
  if (badge) {
    const el = document.createElement('span');
    el.className = 'badge';
    [el.textContent, el.title] = badge;
    a.append(el);
  }
  if (t.cutFrom) a.classList.add('character');
  a.append(name, aka);
  li.append(a);
  return { id: t.id, template: t, el: li, aka, keys: searchKeys(t), category: categoryOf(t) };
}

// First tile of the Backgrounds, opening the editor.
function buildCreateTile(): HTMLLIElement {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'card create';
  a.href = '#editor';
  a.title = 'Create a background';
  const art = document.createElement('span');
  art.className = 'art';
  art.ariaHidden = 'true';
  art.textContent = '+';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = 'Create your own';
  a.append(art, name);
  li.append(a);
  return li;
}
const createTile = buildCreateTile();

interface DiagramCard {
  /** In the URL hash, like a template's id. */
  id: string;
  diagram: Diagram;
  el: HTMLLIElement;
  aka: HTMLSpanElement;
  keys: SearchKeys;
}

/** Something the viewer shows: a template (or character), or a diagram. */
type Entry = Card | DiagramCard;
const isDiagram = (e: Entry): e is DiagramCard => 'diagram' in e;

// mermaid.ink answers 503 to a burst of requests: ask it for a few pictures
// at a time, the viewer's first, and try again a few times, waiting longer
// each time. A picture it has rendered once comes back fast. A request that
// stalls is given up after a while, or it would hold its slot for good.
const MAX_REQUESTS = 3;
const RETRIES = 5;
const TIMEOUT = 30_000;
let requests = 0;
const waiting: (() => void)[] = [];

async function throttled<T>(job: () => Promise<T>, urgent: boolean): Promise<T> {
  if (requests < MAX_REQUESTS) requests++;
  else await new Promise<void>((resolve) => (urgent ? waiting.unshift(resolve) : waiting.push(resolve)));
  try {
    return await job();
  } finally {
    // The slot goes to the next job, or is freed.
    const next = waiting.shift();
    if (next) next();
    else requests--;
  }
}

/** An error that asking again won't fix. */
class Final extends Error {}

async function retried<T>(job: () => Promise<T>, urgent = false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await throttled(job, urgent);
    } catch (err) {
      if (attempt >= RETRIES || err instanceof Final) throw err;
      const delay = 1000 * 2 ** attempt * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function fetchPicture(url: string): Promise<Response> {
  return retried(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (res.ok) return res;
    // A 4xx is the diagram's fault.
    throw new (res.status < 500 ? Final : Error)(`HTTP ${res.status}`);
  }, true);
}

/** Loads a picture of mermaid.ink in an image, unless it leaves the page first. */
function loadPicture(img: HTMLImageElement, src: string, urgent = false): void {
  void retried(
    () =>
      new Promise<void>((resolve, reject) => {
        if (!img.isConnected) return resolve();
        // A lazy image out of sight would hold its slot until it's seen.
        img.loading = 'eager';
        const settle = (err?: Error) => {
          clearTimeout(timer);
          img.onload = img.onerror = null;
          if (!err) return resolve();
          // Stops a stalled request, and shows no broken image until the next try.
          img.removeAttribute('src');
          reject(err);
        };
        const timer = setTimeout(() => settle(new Error('timed out')), TIMEOUT);
        img.onload = () => settle();
        img.onerror = () => settle(new Error('not loaded'));
        img.src = src;
      }),
    urgent,
  ).catch(() => {}); // the image stays empty
}

// Tiles load their picture as they come near the screen.
const nearScreen = new IntersectionObserver(
  (entries) => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting || !(target instanceof HTMLImageElement)) continue;
      nearScreen.unobserve(target);
      const src = target.dataset.src;
      if (src) loadPicture(target, src);
    }
  },
  { rootMargin: '600px 0px' },
);

const pictures = new Map<string, Promise<Pictures>>();
function picturesOf(d: Diagram, format: DiagramFormat): Promise<Pictures> {
  const key = `${d.id}/${format.id}`;
  let p = pictures.get(key);
  if (!p) pictures.set(key, (p = pictureUrls(d, format)));
  return p;
}

interface Svg {
  /** Object URL of the fetched SVG. */
  url: string;
  width: number;
  height: number;
}

// The viewer fetches the SVG rather than pointing at it, to get its size: it's
// only in the viewBox, the picture's width being 100%.
const svgs = new Map<string, Promise<Svg>>();
function svgOf(d: Diagram, format: DiagramFormat): Promise<Svg> {
  const key = `${d.id}/${format.id}`;
  let p = svgs.get(key);
  if (!p) {
    p = (async () => {
      const text = await (await fetchPicture((await picturesOf(d, format)).svg)).text();
      const [, , width = 0, height = 0] = (text.match(/viewBox="([^"]*)"/)?.[1] ?? '')
        .split(/[\s,]+/)
        .map(Number);
      const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      return { url, width: Math.round(width), height: Math.round(height) };
    })();
    p.catch(() => svgs.delete(key)); // try again next time
    svgs.set(key, p);
  }
  return p;
}

// A diagram's tile: its picture in the default format. Its name is its type:
// the example's name is its alias.
function buildDiagramCard(d: Diagram): DiagramCard {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'card diagram';
  a.href = `#diagrams/${d.id}`;
  a.title = `${d.type}: ${d.name}`;

  const img = document.createElement('img');
  img.decoding = 'async';
  img.alt = '';
  void picturesOf(d, FORMATS[0]).then((p) => {
    img.dataset.src = p.svg;
    nearScreen.observe(img);
  });

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'Diagram';
  badge.title = 'Mermaid diagram';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = d.type;
  const aka = document.createElement('span');
  aka.className = 'aka';
  aka.hidden = true;
  a.append(img, badge, name, aka);
  li.append(a);
  // "diagram" or "mermaid" find them all. The alias has the type and keywords
  // too, so that "C4 coffee" finds the C4 diagram of the coffee machine.
  const keywords = `${d.type} diagram mermaid`;
  const keys = { name: fold(keywords), aliases: [fold(`${d.name} ${keywords}`)] };
  return { id: `diagrams/${d.id}`, diagram: d, el: li, aka, keys };
}
const diagramCards = DIAGRAMS.map(buildDiagramCard);
const diagramById = new Map(diagramCards.map((c) => [c.id, c]));
const diagramsByName = [...diagramCards].sort((a, b) =>
  a.diagram.type.localeCompare(b.diagram.type, 'en', { sensitivity: 'base' }),
);

const sortKey = (): SortKey => (isSortKey(sort.value) ? sort.value : 'rank');
const selectedCategory = (): Category | null => (isCategory(category.value) ? category.value : null);

function fillCategories(): void {
  for (const [key, label] of Object.entries(CATEGORIES)) {
    const n = key === 'diagrams' ? diagramCards.length : cards.filter((c) => c.category === key).length;
    category.append(new Option(`${label} (${fmt.format(n)})`, key));
  }
}

function emptyMessage(query: string, cat: Category | null): string {
  const where = cat ? ` in ${CATEGORIES[cat]}` : '';
  return query ? `No template matches “${query}”${where}.` : `No template${where} yet.`;
}

function render(): void {
  const words = searchWords(search.value);
  const cat = selectedCategory();
  const compare = SORTS[sortKey()];
  const ordered = [...cards].sort((a, b) => compare(a.template, b.template));
  visible = [];

  for (const card of ordered) {
    const found = !cat || card.category === cat ? match(card.keys, words) : null;
    const alias = found?.alias ?? -1;
    card.el.hidden = !found;
    card.aka.hidden = alias < 0;
    if (alias > -1) card.aka.textContent = `aka ${card.template.aliases[alias]}`;
    if (found) visible.push(card);
  }
  // Diagrams come after the templates, in their own order unless by name.
  const diagrams = sortKey() === 'name' ? diagramsByName : diagramCards;
  for (const card of diagrams) {
    const found = !cat || cat === 'diagrams' ? match(card.keys, words) : null;
    card.el.hidden = !found;
    card.aka.hidden = !found || found.alias < 0;
    if (found && found.alias > -1) card.aka.textContent = `aka ${card.diagram.name}`;
    if (found) visible.push(card);
  }
  const create = cat === 'background' && !words.length;
  grid.replaceChildren(
    ...(create ? [createTile] : []),
    ...ordered.map((c) => c.el),
    ...diagrams.map((c) => c.el),
  );

  const total = cards.length + diagramCards.length;
  const shown = visible.length;
  count.textContent =
    shown === total ? `${fmt.format(total)} templates` : `${fmt.format(shown)} of ${fmt.format(total)}`;
  const hint = templatesMissing && cat !== 'diagrams';
  empty.hidden = shown > 0 && !hint;
  if (hint)
    empty.innerHTML =
      'No templates found. Run <code>npm run fetch:imgflip</code> then <code>npm run dedupe</code>, and reload.';
  else if (!shown) empty.textContent = emptyMessage(search.value.trim(), cat);

  const url = new URL(location.href);
  if (search.value.trim()) url.searchParams.set('q', search.value.trim());
  else url.searchParams.delete('q');
  if (cat) url.searchParams.set('category', cat);
  else url.searchParams.delete('category');
  if (sort.value === 'rank') url.searchParams.delete('sort');
  else url.searchParams.set('sort', sort.value);
  history.replaceState(null, '', url);
}

function setHash(id: string): void {
  history.replaceState(null, '', location.pathname + location.search + (id ? `#${id}` : ''));
}

// Shows a file of the current template in the stage: its own, or one of its
// duplicates'.
function display(card: Card, t: Duplicate): void {
  big.hidden = !!t.animated;
  bigVideo.hidden = !t.animated;
  for (const el of [big, bigVideo]) {
    el.style.maxWidth = `${t.width}px`;
    el.style.maxHeight = `${t.height}px`;
  }
  if (t.animated) {
    big.removeAttribute('src');
    bigVideo.poster = thumbUrl(t);
    bigVideo.src = imgUrl(t);
    bigVideo.play().catch(() => {});
  } else {
    bigVideo.removeAttribute('src');
    bigVideo.load();
    // Show the cached thumbnail straight away, then swap in the original.
    big.src = thumbUrl(t);
    big.alt = t.name;
    const full = new Image();
    full.onload = () => {
      if (current === card && shown === t) big.src = full.src;
    };
    full.src = imgUrl(t);
  }
  shown = t;

  const own = t === card.template;
  const from = card.template.cutFrom ? byId.get(card.template.cutFrom)?.template : undefined;
  $('meta').textContent =
    (own ? '' : `Duplicate “${t.name}” · `) +
    (from ? `Cut out of “${from.name}”` : `#${t.rank} on ${t.source.site}`) +
    ` · ${t.width} × ${t.height} · ${t.file.split('.').pop()?.toUpperCase()}` +
    (t.animated ? ' · animated' : '');
  editLink.href = editHash({ id: card.id, ...(!own && { file: t.file }) });
  editLink.textContent = t.animated ? 'Edit still' : 'Edit';
  editLink.hidden = !stillUrl(t);
  openLink.href = imgUrl(t);
  downloadLink.href = imgUrl(t);
  downloadLink.download = t.file.split('/').pop() ?? t.file;
  sourceLink.href = t.source.pageUrl;
  sourceLink.textContent = 'View on imgflip';
  // A character is looked up by the meme it was cut out of.
  kymLink.href = kymUrl((from ?? card.template).name);
  kymLink.hidden = false;
  const gifMaker = t.animated && gifMakerUrl(t.source);
  gifMakerLink.hidden = !gifMaker;
  if (gifMaker) gifMakerLink.href = gifMaker;
  for (const li of formatList.children) {
    const button = li.firstElementChild;
    if (button instanceof HTMLElement) button.ariaCurrent = button.dataset.file === t.file ? 'true' : null;
  }
}

// An alternative's tile, with its picture, or without for now when it's null.
function relatedItem(src: string | null, label: string, detail: string): HTMLLIElement {
  const li = document.createElement('li');
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  if (src) img.src = src;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = label;
  const small = document.createElement('small');
  small.textContent = detail;
  li.append(img, name, small);
  return li;
}

const size = (t: Duplicate) => `${t.width} × ${t.height}${t.animated ? ' · GIF' : ''}`;

// Fills the alternatives panel for a template.
function renderRelated(card: Card): void {
  const t = card.template;
  const duplicates = t.duplicates ?? [];
  const variants = (t.variants ?? []).flatMap((id) => byId.get(id) ?? []);
  const withDuplicates = showDuplicates.checked && duplicates.length > 0;

  formatList.replaceChildren(
    ...(withDuplicates ? [t, ...duplicates] : []).map((d) => {
      const li = relatedItem(thumbUrl(d), d === t ? 'Main' : d.name, size(d));
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.file = d.file;
      button.title = d === t ? t.name : `${d.name} (#${d.rank})`;
      button.append(...li.childNodes);
      li.append(button);
      return li;
    }),
  );
  variationList.replaceChildren(
    ...variants.map((v) => {
      const detail = size(v.template) + (v.template.cutFrom ? ' · character' : '');
      const li = relatedItem(thumbUrl(v.template), v.template.name, detail);
      const a = document.createElement('a');
      a.href = `#${v.template.id}`;
      a.title = v.template.name;
      a.append(...li.childNodes);
      li.append(a);
      return li;
    }),
  );
  formats.hidden = !withDuplicates;
  variations.hidden = !variants.length;
  relatedEmpty.hidden = withDuplicates || variants.length > 0;
  showDuplicates.parentElement!.hidden = !duplicates.length;

  // The panel is offered whenever there is something to show in it, so the
  // duplicates switch stays reachable when it is off.
  const available = duplicates.length + variants.length > 0;
  const n = (withDuplicates ? duplicates.length : 0) + variants.length;
  relatedToggle.hidden = !available;
  relatedCount.textContent = n ? `(${n})` : '';
  setPanel(panelOpen, available);
}

// Shows a diagram in a format: its picture, and links to it and to edit it.
function displayDiagram(card: DiagramCard, format: DiagramFormat): void {
  const d = card.diagram;
  shownFormat = format;
  const stale = () => current !== card || shownFormat !== format;
  big.hidden = false;
  bigVideo.hidden = true;
  bigVideo.removeAttribute('src');
  bigVideo.load();
  big.removeAttribute('src');
  big.alt = `${d.type} diagram: ${d.name}`;
  const meta = `Mermaid diagram · ${format.name} format`;
  $('meta').textContent = `${meta} · rendering…`;
  // Until the links are ready, they lead to the editor.
  sourceLink.href = openLink.href = downloadLink.href = editorUrl(d, format);
  sourceLink.textContent = 'Edit in mermaid.live';
  kymLink.hidden = true;
  gifMakerLink.hidden = true;
  editLink.hidden = true;
  downloadLink.download = `${d.id}-${format.id}.png`;
  for (const li of formatList.children) {
    const button = li.firstElementChild;
    if (button instanceof HTMLElement)
      button.ariaCurrent = button.dataset.format === format.id ? 'true' : null;
  }
  void picturesOf(d, format).then((p) => {
    if (stale()) return;
    openLink.href = p.svg;
    downloadLink.href = p.png;
  });
  svgOf(d, format).then(
    (svg) => {
      if (stale()) return;
      big.style.maxWidth = `${svg.width}px`;
      big.style.maxHeight = `${svg.height}px`;
      big.src = svg.url;
      $('meta').textContent = `${meta} · ${svg.width} × ${svg.height} · SVG`;
    },
    (err: unknown) => {
      if (!stale())
        $('meta').textContent = `${meta} · mermaid.ink could not render it (${(err as Error).message})`;
    },
  );
}

// Fills the alternatives panel for a diagram: its formats.
function renderDiagramRelated(card: DiagramCard): void {
  const d = card.diagram;
  formatList.replaceChildren(
    ...FORMATS.map((f) => {
      const li = relatedItem(null, f.name, f.description);
      const img = li.querySelector('img')!;
      void picturesOf(d, f).then((p) => loadPicture(img, p.svg, true));
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.format = f.id;
      button.title = `${d.type} in the ${f.name} format`;
      button.append(...li.childNodes);
      li.append(button);
      return li;
    }),
  );
  variationList.replaceChildren();
  formats.hidden = false;
  variations.hidden = true;
  relatedEmpty.hidden = true;
  showDuplicates.parentElement!.hidden = true;
  // Counted like a template's duplicates: the other formats.
  relatedToggle.hidden = false;
  relatedCount.textContent = `(${FORMATS.length - 1})`;
  setPanel(panelOpen, true);
}

// Downloads the PNG: it's on another site, which a download link can't do.
async function downloadDiagram(d: Diagram, format: DiagramFormat): Promise<void> {
  const { png } = await picturesOf(d, format);
  downloadLink.ariaBusy = 'true';
  try {
    const blob = await (await fetchPicture(png)).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${d.id}-${format.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  } catch {
    window.open(png, '_blank', 'noopener');
  } finally {
    downloadLink.ariaBusy = null;
  }
}

function setPanel(open: boolean, available = !relatedToggle.hidden): void {
  related.hidden = !(open && available);
  relatedToggle.ariaExpanded = String(open && available);
  relatedToggle.ariaPressed = String(open && available);
}

function togglePanel(): void {
  if (relatedToggle.hidden) return;
  panelOpen = related.hidden === true;
  prefs.set('alternatives', panelOpen);
  setPanel(panelOpen);
}

// Shows a card in the viewer, and in the URL hash unless it's kept as it is.
function show(card: Entry, keepHash = false): void {
  current = card;
  let aliases: string[];
  if (isDiagram(card)) {
    $('title').textContent = card.diagram.type;
    aliases = [card.diagram.name];
    renderDiagramRelated(card);
    displayDiagram(card, FORMATS[0]);
  } else {
    const t = card.template;
    $('title').textContent = t.name;
    aliases = t.aliases;
    renderRelated(card);
    display(card, t);
  }
  aliasesEl.textContent = aliases.length ? `Also known as: ${aliases.join(', ')}` : '';
  aliasesEl.hidden = !aliases.length;
  related.scrollTop = 0;

  const many = visible.length > 1 && visible.includes(card);
  prev.hidden = next.hidden = !many;

  if (!keepHash) setHash(card.id);
  if (!viewer.open) viewer.showModal();
}

// Opens the meme editor on a file of a template: its own, or a duplicate's.
function edit(card: Card, t: Duplicate, params?: URLSearchParams): void {
  const src = stillUrl(t);
  if (!src) return;
  const file = t === card.template ? undefined : t.file;
  memeEditor.open({ name: card.template.name, src, link: { id: card.id, ...(file && { file }) } }, params);
}

function step(delta: number): void {
  const i = current ? visible.indexOf(current) : -1;
  if (i < 0 || visible.length < 2) return;
  show(visible[(i + delta + visible.length) % visible.length]);
}

// What a hash names, which is nothing when it isn't a well-formed address.
function idOf(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return '';
  }
}

function openFromHash(): void {
  if (isEditorHash(location.hash)) {
    if (viewer.open) viewer.close();
    if (memeEditor.isOpen) memeEditor.close();
    editor.open(new URLSearchParams(location.hash.split('?')[1]));
    return;
  }
  if (editor.isOpen) editor.close();
  const link = parseEditHash(location.hash);
  const edited = link && byId.get(link.id);
  if (link && edited) {
    // Over the viewer, on the file that is edited.
    const t = edited.template;
    const file = (t.duplicates ?? []).find((d) => d.file === link.file) ?? t;
    show(edited, true);
    if (file !== t) display(edited, file);
    edit(edited, file, link.params);
    return;
  }
  if (memeEditor.isOpen) memeEditor.close();
  const id = idOf(location.hash);
  const card = id ? (byId.get(id) ?? diagramById.get(id)) : undefined;
  if (card) show(card);
  else if (viewer.open) viewer.close();
}

grid.addEventListener('click', (e) => {
  const link = (e.target as Element).closest('.card');
  if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  const li = link.parentElement;
  const card = cards.find((c) => c.el === li) ?? diagramCards.find((c) => c.el === li);
  if (!card) return; // the create tile follows its link to the editor
  e.preventDefault();
  show(card);
});
$('close').addEventListener('click', () => viewer.close());
relatedToggle.addEventListener('click', togglePanel);
$('relatedClose').addEventListener('click', togglePanel);
showDuplicates.addEventListener('change', () => {
  prefs.set('duplicates', showDuplicates.checked);
  if (!current || isDiagram(current)) return;
  renderRelated(current);
  // A duplicate on show goes back to the template's own file when hidden.
  display(current, showDuplicates.checked && shown ? shown : current.template);
});
formatList.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLElement>('button[data-file], button[data-format]');
  if (!button || !current) return;
  if (isDiagram(current)) {
    const format = FORMATS.find((f) => f.id === button.dataset.format);
    if (format) displayDiagram(current, format);
    return;
  }
  const t = current.template;
  const file = button.dataset.file;
  display(current, [t, ...(t.duplicates ?? [])].find((d) => d.file === file) ?? t);
});
variationList.addEventListener('click', (e) => {
  const link = (e.target as Element).closest('a');
  if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  const card = byId.get(idOf(link.hash));
  if (card) show(card);
});
editLink.addEventListener('click', (e) => {
  if (!current || isDiagram(current) || !shown || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  edit(current, shown);
});
downloadLink.addEventListener('click', (e) => {
  if (!current || !isDiagram(current) || !shownFormat || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  if (!downloadLink.ariaBusy) void downloadDiagram(current.diagram, shownFormat);
});
prev.addEventListener('click', () => step(-1));
next.addEventListener('click', () => step(1));
viewer.addEventListener('click', (e) => {
  if (e.target === viewer) viewer.close();
});
// Closing the viewer selects the template it was on, unless a shortcut closed
// it to go elsewhere.
let reselect = true;
function closeViewer(): void {
  if (!viewer.open) return;
  reselect = false;
  viewer.close();
}
viewer.addEventListener('close', () => {
  const was = current;
  if (reselect && was && !was.el.hidden && !editor.isOpen && !memeEditor.isOpen) select(tileOf(was));
  reselect = true;
  current = null;
  shown = null;
  shownFormat = null;
  big.removeAttribute('src');
  bigVideo.removeAttribute('src');
  bigVideo.load();
  // Unless it's closing for the editor, opened from the address bar.
  if (!isEditorHash(location.hash)) setHash('');
});
window.addEventListener('hashchange', openFromHash);
$('createFromImage').addEventListener('click', () => importImage.click());
importImage.addEventListener('change', () => {
  createFrom(importImage.files?.[0]);
  importImage.value = '';
});
// An image dropped or pasted on the list is imported too.
document.addEventListener('dragover', (e) => {
  if (!anyOpen() && e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (anyOpen() || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  createFrom([...e.dataTransfer.files].find((f) => f.type.startsWith('image/')));
});
document.addEventListener('paste', (e) => {
  if (anyOpen() || e.target instanceof HTMLInputElement) return;
  if (createFrom([...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))))
    e.preventDefault();
});

// --- keyboard shortcuts, listed in shortcuts.ts

const tileOf = (entry: Entry): HTMLElement => entry.el.firstElementChild as HTMLElement;
const tiles = (): HTMLElement[] =>
  [...grid.children].flatMap((li) =>
    li instanceof HTMLElement && !li.hidden ? [li.firstElementChild as HTMLElement] : [],
  );
const entryOf = (tile: Element): Entry | undefined =>
  cards.find((c) => tileOf(c) === tile) ?? diagramCards.find((c) => tileOf(c) === tile);
const selectedTile = (): HTMLElement | null =>
  document.activeElement instanceof HTMLElement && document.activeElement.closest('#grid')
    ? document.activeElement.closest<HTMLElement>('.card')
    : null;

// Focuses a tile and scrolls it into view, clear of the sticky header.
function select(tile: HTMLElement): void {
  tile.focus({ preventScroll: true });
  const r = tile.getBoundingClientRect();
  const top = header.getBoundingClientRect().bottom + 12;
  if (r.top < top) scrollBy(0, r.top - top);
  else if (r.bottom > innerHeight - 12) scrollBy(0, r.bottom - innerHeight + 12);
}

function moveSelection(key: string): void {
  const all = tiles();
  if (!all.length) return;
  const at = all.indexOf(selectedTile()!);
  if (at < 0) {
    // The first tile in sight.
    const top = header.getBoundingClientRect().bottom;
    select(all.find((t) => t.getBoundingClientRect().bottom > top) ?? all[0]);
    return;
  }
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const lastRow = Math.floor((all.length - 1) / columns);
  let to = at;
  if (key === 'ArrowLeft') to = at - 1;
  else if (key === 'ArrowRight') to = at + 1;
  else if (key === 'ArrowUp') to = at - columns;
  // Down from the row above a shorter last one goes to its last tile.
  else if (Math.floor(at / columns) < lastRow) to = Math.min(at + columns, all.length - 1);
  if (all[to]) select(all[to]);
}

function goTo(cat: Category | null): void {
  closeViewer();
  category.value = cat ?? '';
  render();
  selectedTile()?.blur();
  scrollTo({ top: 0 });
}

function toTop(): void {
  if (memeEditor.isOpen) $('memeForm').scrollTo({ top: 0, behavior: 'smooth' });
  else if (editor.isOpen) $('editorForm').scrollTo({ top: 0, behavior: 'smooth' });
  else if (viewer.open) related.scrollTo({ top: 0, behavior: 'smooth' });
  else {
    selectedTile()?.blur();
    scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Fields keys are typed in: letters there are text, not shortcuts.
const UNTYPED = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);
function isField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
    return true;
  return el instanceof HTMLInputElement && !UNTYPED.has(el.type);
}

function hasSelection(): boolean {
  const el = document.activeElement;
  if (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    el.selectionStart !== el.selectionEnd
  )
    return true;
  return document.getSelection()?.isCollapsed === false;
}

function viewerKey(key: string): boolean {
  if (key === 'ArrowLeft') step(-1);
  else if (key === 'ArrowRight') step(1);
  else if (key === 'a') togglePanel();
  else if (key === 'e' && current && !isDiagram(current) && shown && !editLink.hidden) edit(current, shown);
  else if (key === 'o') openLink.click();
  else if (key === 'd') downloadLink.click();
  else return false;
  return true;
}

function gridKey(key: string): boolean {
  const tile = selectedTile();
  if (key.startsWith('Arrow')) {
    // Unless something else on the page is in focus.
    if (!tile && document.activeElement !== document.body) return false;
    moveSelection(key);
  } else if (key === 'o' && tile) tile.click();
  else if (key === 'e' && tile) {
    const entry = entryOf(tile);
    if (!entry || isDiagram(entry)) return false;
    show(entry);
    edit(entry, entry.template);
  } else return false;
  return true;
}

// Waiting for the key after g.
let going: ReturnType<typeof setTimeout> | undefined;

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && key === 'c' && !e.altKey && !e.shiftKey) {
    if (memeEditor.isOpen && !help.isOpen && !hasSelection() && memeEditor.copy()) e.preventDefault();
    return;
  }
  if (mod || e.altKey || isField(e.target as Element) || isField(document.activeElement)) return;
  if (key === '?') {
    e.preventDefault();
    help.toggle();
    return;
  }
  if (help.isOpen) return;

  let handled = true;
  const after = going;
  clearTimeout(going);
  going = undefined;
  const target = after === undefined ? undefined : goToCategory(key);
  if (target !== undefined) goTo(target);
  else if (key === '.') toTop();
  else if (memeEditor.isOpen) {
    if (key === 'd') memeEditor.download();
    else if (key === 's') memeEditor.focusSearch();
    else handled = false;
  } else if (editor.isOpen) {
    if (key === 'd') editor.download();
    else handled = false;
  } else if (key === 'g') going = setTimeout(() => (going = undefined), GO_DELAY);
  else if (key === 's' || key === '/') {
    closeViewer();
    search.select();
  } else if (key === 'n') location.hash = '#editor';
  else handled = viewer.open ? viewerKey(key) : gridKey(key);
  if (handled) e.preventDefault();
});
search.addEventListener('input', render);
category.addEventListener('change', render);
sort.addEventListener('change', render);

async function init(): Promise<void> {
  const [res, charactersRes] = await Promise.all([fetch('/api/templates'), fetch('/api/characters')]);
  // Without templates, the diagrams and the editor still work.
  templatesMissing = !res.ok;
  // Characters are optional: `npm run extract:characters` makes them.
  const characters = charactersRes.ok ? ((await charactersRes.json()) as Character[]) : [];
  const templates = res.ok ? ((await res.json()) as Template[]) : [];
  cards = withCharacters(templates, characters).map(buildCard);
  byId = new Map(cards.map((c) => [c.template.id, c]));
  editor.setLibrary(cards.map((c) => c.template));
  memeEditor.setLibrary(cards.map((c) => c.template));
  fillCategories();

  const params = new URLSearchParams(location.search);
  search.value = params.get('q') ?? '';
  const categoryParam = params.get('category');
  if (isCategory(categoryParam)) category.value = categoryParam;
  const sortParam = params.get('sort');
  if (isSortKey(sortParam)) sort.value = sortParam;
  const hash = location.hash;
  render();
  // An image imported while the templates were loading isn't replaced by the address.
  if (hash && memeEditor.isOpen) setHash('');
  else if (hash) {
    history.replaceState(null, '', location.pathname + location.search + hash);
    openFromHash();
  }
}

init().catch((err: unknown) => {
  empty.hidden = false;
  empty.textContent = `Could not load templates: ${(err as Error).message}`;
});
