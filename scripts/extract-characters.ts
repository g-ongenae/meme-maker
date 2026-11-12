// Cut the characters out of the templates listed in scripts/characters.json
// (advice animals and the like: a subject over a flat or geometric
// background) and write them to data/characters/ as transparent PNGs, with
// data/characters/index.json, plus data/characters.html to review them.
// Run after `npm run dedupe`: the templates come from data/templates/.
//
// Each entry of scripts/characters.json names a template and, when the
// defaults don't cut it out cleanly, options for scripts/cutout.ts (edges the
// subject is cut off by, colour tolerance, rectangles to erase or keep…).
//
// Usage: npm run extract:characters -- [--only <template id>,<template id>]

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp, { type Sharp } from 'sharp';
import type { Character } from '../client/characters.ts';
import type { Template } from '../client/templates.ts';
import { type CutoutOptions, type RawImage, backgroundMask, cutout } from './cutout.ts';

export interface CharacterEntry extends CutoutOptions {
  /** Id of the template to cut the character out of. */
  template: string;
  /** Defaults to the template's id. */
  id?: string;
  /** Defaults to the template's name. */
  name?: string;
}

const { values: args } = parseArgs({ options: { only: { type: 'string' } } });
const ONLY = args.only?.split(',') ?? null;
const TEMPLATES_DIR = path.resolve('data/templates');
const OUT_DIR = path.resolve('data/characters');
const CONFIG = path.resolve('scripts/characters.json');

async function pixels(image: Sharp): Promise<RawImage> {
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: 3, data: new Uint8Array(data) };
}

async function main(): Promise<void> {
  const entries = JSON.parse(await readFile(CONFIG, 'utf8')) as CharacterEntry[];
  const templates = JSON.parse(await readFile(path.join(TEMPLATES_DIR, 'index.json'), 'utf8')) as Template[];
  const byId = new Map(templates.map((t) => [t.id, t]));

  // A partial run keeps the other characters.
  const previous: Character[] = ONLY
    ? JSON.parse(await readFile(path.join(OUT_DIR, 'index.json'), 'utf8').catch(() => '[]'))
    : [];
  if (!ONLY) await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const characters = new Map(previous.map((c) => [c.id, c]));
  const missing: string[] = [];
  for (const { template: templateId, id = templateId, name, ...options } of entries) {
    if (ONLY && !ONLY.includes(templateId) && !ONLY.includes(id)) continue;
    const t = byId.get(templateId);
    if (!t || t.animated) {
      missing.push(templateId);
      continue;
    }
    const src = path.join(TEMPLATES_DIR, t.file);
    const [img, smooth] = await Promise.all([pixels(sharp(src)), pixels(sharp(src).median(3))]);
    const cut = cutout(img, backgroundMask(smooth, options), options);
    if (!cut.width) {
      console.warn(`${id}: nothing left after removing the background`);
      continue;
    }
    const file = `${id}.png`;
    await sharp(cut.data, { raw: { width: cut.width, height: cut.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, file));
    characters.set(id, {
      id,
      name: name ?? t.name,
      file,
      width: cut.width,
      height: cut.height,
      template: t.id,
    });
    process.stdout.write(`\r${characters.size} characters`);
  }
  console.log();
  if (missing.length) console.warn(`not in data/templates (or animated), skipped: ${missing.join(', ')}`);

  // In the config's order.
  const order = new Map(entries.map((e, i) => [e.id ?? e.template, i]));
  const list = [...characters.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(list, null, 2));
  await writeFile(path.resolve('data/characters.html'), renderReport(list, byId));
  console.log(`wrote ${list.length} characters to ${OUT_DIR}/ and data/characters.html`);
}

function renderReport(characters: Character[], templates: Map<string, Template>): string {
  const esc = (s: string | number) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows = characters
    .map((c) => {
      const t = templates.get(c.template);
      return `<figure><div><img src="templates/${esc(t?.file ?? '')}"><img class="cut" src="characters/${esc(c.file)}"></div>
<figcaption>${esc(c.name)} <small>${c.width}×${c.height}</small></figcaption></figure>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Characters</title>
<style>
body{font:14px system-ui;margin:24px;background:#111;color:#eee}
main{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0}figure div{display:flex;gap:4px}
img{width:200px;height:200px;object-fit:contain;background:#222}
img.cut{background:repeating-conic-gradient(#bbb 0 25%,#eee 0 50%) 0 0/16px 16px}
figcaption{font-size:12px;color:#aaa}small{color:#777}
</style>
<h1>${characters.length} characters</h1>
<p>Each template, then the character cut out of it (over a checkerboard: it's transparent).
Tune the cut-outs in scripts/characters.json.</p>
<main>${rows}</main>`;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
