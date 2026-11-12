// Template browser: grid with search, category filter and sort, plus a viewer
// dialog with a side panel of alternatives: the template's other formats (the
// duplicates merged into it) and its variations (related templates).

import { type Category, CATEGORIES, categoryOf, isCategory } from './categories.ts';
import {
  type Duplicate,
  type SearchKeys,
  type SortKey,
  type Template,
  SORTS,
  imgUrl,
  isSortKey,
  match,
  searchKeys,
  searchWords,
  thumbUrl,
} from './templates.ts';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

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
const openLink = $<HTMLAnchorElement>('open');
const downloadLink = $<HTMLAnchorElement>('download');
const sourceLink = $<HTMLAnchorElement>('source');
const related = $('related');
const relatedToggle = $<HTMLButtonElement>('relatedToggle');
const relatedCount = $('relatedCount');
const showDuplicates = $<HTMLInputElement>('showDuplicates');
const formats = $('formats');
const formatList = $<HTMLUListElement>('formatList');
const variations = $('variations');
const variationList = $<HTMLUListElement>('variationList');
const relatedEmpty = $('relatedEmpty');

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
  template: Template;
  el: HTMLLIElement;
  aka: HTMLSpanElement;
  keys: SearchKeys;
  category: Category;
}

let cards: Card[] = [];
let byId = new Map<string, Card>();
let visible: Card[] = []; // cards currently shown, in display order
let current: Card | null = null; // card open in the viewer
let shown: Duplicate | null = null; // file shown in the viewer: the template's or a duplicate's

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
  if (t.animated) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'GIF';
    badge.title = 'Animated template';
    a.append(badge);
  }
  a.append(name, aka);
  li.append(a);
  return { template: t, el: li, aka, keys: searchKeys(t), category: categoryOf(t) };
}

const sortKey = (): SortKey => (isSortKey(sort.value) ? sort.value : 'rank');
const selectedCategory = (): Category | null => (isCategory(category.value) ? category.value : null);

function fillCategories(): void {
  for (const [key, label] of Object.entries(CATEGORIES)) {
    const n = cards.filter((c) => c.category === key).length;
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
  grid.replaceChildren(...ordered.map((c) => c.el));

  count.textContent =
    visible.length === cards.length
      ? `${fmt.format(cards.length)} templates`
      : `${fmt.format(visible.length)} of ${fmt.format(cards.length)}`;
  empty.hidden = visible.length > 0;
  if (!visible.length) empty.textContent = emptyMessage(search.value.trim(), cat);

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
  $('meta').textContent =
    (own ? '' : `Duplicate “${t.name}” · `) +
    `#${t.rank} on ${t.source.site} · ${t.width} × ${t.height} · ${t.file.split('.').pop()?.toUpperCase()}` +
    (t.animated ? ' · animated' : '');
  openLink.href = imgUrl(t);
  downloadLink.href = imgUrl(t);
  downloadLink.download = t.file;
  sourceLink.href = t.source.pageUrl;
  for (const li of formatList.children) {
    const button = li.firstElementChild;
    if (button instanceof HTMLElement) button.ariaCurrent = button.dataset.file === t.file ? 'true' : null;
  }
}

function relatedItem(media: Duplicate, label: string, detail: string): HTMLLIElement {
  const li = document.createElement('li');
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.src = thumbUrl(media);
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
      const li = relatedItem(d, d === t ? 'Main' : d.name, size(d));
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
      const li = relatedItem(v.template, v.template.name, size(v.template));
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

function show(card: Card): void {
  const t = card.template;
  current = card;
  $('title').textContent = t.name;
  aliasesEl.textContent = t.aliases.length ? `Also known as: ${t.aliases.join(', ')}` : '';
  aliasesEl.hidden = !t.aliases.length;
  renderRelated(card);
  display(card, t);
  related.scrollTop = 0;

  const many = visible.length > 1 && visible.includes(card);
  prev.hidden = next.hidden = !many;

  setHash(t.id);
  if (!viewer.open) viewer.showModal();
}

function step(delta: number): void {
  const i = current ? visible.indexOf(current) : -1;
  if (i < 0 || visible.length < 2) return;
  show(visible[(i + delta + visible.length) % visible.length]);
}

function openFromHash(): void {
  const id = decodeURIComponent(location.hash.slice(1));
  const card = id ? byId.get(id) : undefined;
  if (card) show(card);
  else if (viewer.open) viewer.close();
}

grid.addEventListener('click', (e) => {
  const link = (e.target as Element).closest('.card');
  if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  const card = cards.find((c) => c.el === link.parentElement);
  if (card) show(card);
});
$('close').addEventListener('click', () => viewer.close());
relatedToggle.addEventListener('click', togglePanel);
$('relatedClose').addEventListener('click', togglePanel);
showDuplicates.addEventListener('change', () => {
  prefs.set('duplicates', showDuplicates.checked);
  if (!current) return;
  renderRelated(current);
  // A duplicate on show goes back to the template's own file when hidden.
  display(current, showDuplicates.checked && shown ? shown : current.template);
});
formatList.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLElement>('button[data-file]');
  const t = current?.template;
  if (!button || !current || !t) return;
  const file = button.dataset.file;
  display(current, [t, ...(t.duplicates ?? [])].find((d) => d.file === file) ?? t);
});
variationList.addEventListener('click', (e) => {
  const link = (e.target as Element).closest('a');
  if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  const card = byId.get(decodeURIComponent(link.hash.slice(1)));
  if (card) show(card);
});
prev.addEventListener('click', () => step(-1));
next.addEventListener('click', () => step(1));
viewer.addEventListener('click', (e) => {
  if (e.target === viewer) viewer.close();
});
viewer.addEventListener('close', () => {
  current = null;
  shown = null;
  big.removeAttribute('src');
  bigVideo.removeAttribute('src');
  bigVideo.load();
  setHash('');
});
viewer.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) togglePanel();
});
window.addEventListener('hashchange', openFromHash);
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== search && !viewer.open) {
    e.preventDefault();
    search.select();
  }
});
search.addEventListener('input', render);
category.addEventListener('change', render);
sort.addEventListener('change', render);

async function init(): Promise<void> {
  const res = await fetch('/api/templates');
  if (!res.ok) {
    empty.hidden = false;
    empty.innerHTML =
      'No templates found. Run <code>npm run fetch:imgflip</code> then <code>npm run dedupe</code>, and reload.';
    return;
  }
  cards = ((await res.json()) as Template[]).map(buildCard);
  byId = new Map(cards.map((c) => [c.template.id, c]));
  fillCategories();

  const params = new URLSearchParams(location.search);
  search.value = params.get('q') ?? '';
  const categoryParam = params.get('category');
  if (isCategory(categoryParam)) category.value = categoryParam;
  const sortParam = params.get('sort');
  if (isSortKey(sortParam)) sort.value = sortParam;
  const hash = location.hash;
  render();
  if (hash) {
    history.replaceState(null, '', location.pathname + location.search + hash);
    openFromHash();
  }
}

init().catch((err: unknown) => {
  empty.hidden = false;
  empty.textContent = `Could not load templates: ${(err as Error).message}`;
});
