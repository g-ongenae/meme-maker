// Template browser: grid with search, category filter and sort, plus a viewer dialog.

import { type Category, CATEGORIES, categoryOf, isCategory } from './categories.ts';
import {
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

const fmt = new Intl.NumberFormat('en');

interface Card {
  template: Template;
  el: HTMLLIElement;
  aka: HTMLSpanElement;
  keys: SearchKeys;
  category: Category;
}

let cards: Card[] = [];
let visible: Card[] = []; // cards currently shown, in display order
let current: Card | null = null; // card open in the viewer

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

function show(card: Card): void {
  const t = card.template;
  current = card;
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
      if (current === card) big.src = full.src;
    };
    full.src = imgUrl(t);
  }

  $('title').textContent = t.name;
  $('meta').textContent =
    `#${t.rank} on ${t.source.site} · ${t.width} × ${t.height} · ${t.file.split('.').pop()?.toUpperCase()}` +
    (t.animated ? ' · animated' : '');
  aliasesEl.textContent = t.aliases.length ? `Also known as: ${t.aliases.join(', ')}` : '';
  aliasesEl.hidden = !t.aliases.length;
  openLink.href = imgUrl(t);
  downloadLink.href = imgUrl(t);
  downloadLink.download = t.file;
  sourceLink.href = t.source.pageUrl;

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
  const card = id ? cards.find((c) => c.template.id === id) : undefined;
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
prev.addEventListener('click', () => step(-1));
next.addEventListener('click', () => step(1));
viewer.addEventListener('click', (e) => {
  if (e.target === viewer) viewer.close();
});
viewer.addEventListener('close', () => {
  current = null;
  big.removeAttribute('src');
  bigVideo.removeAttribute('src');
  bigVideo.load();
  setHash('');
});
viewer.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
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
