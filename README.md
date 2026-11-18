<img src="assets/icon.svg" width="64" height="64" alt="">

# meme-maker

Created in [T3 Code](https://t3.codes).

## Templates

```sh
npm install
npm run fetch:imgflip   # scrape all pages of imgflip.com/memetemplates → data/raw/imgflip/
npm run dedupe          # remove duplicates → data/templates/ (+ index.json)
npm run extract:characters  # cut characters out of templates → data/characters/ (+ index.json)
```

- `fetch:imgflip` downloads the full-size original of every template (falling back
  to `.png`/`.gif` when the `.jpg` doesn't exist). Animated ("GIF") templates are
  downloaded as the `.mp4` imgflip serves them as. It's resumable: already-downloaded
  files are skipped, and templates that have dropped out of imgflip's listing since
  the last run are kept.
- `dedupe` trims uniform borders, then groups images that are the same picture
  (perceptual dHash + colour thumbnail + aspect ratio) or a crop of one another
  (normalized cross-correlation, then the same checks on the aligned region). It
  keeps the most popular name and the highest-resolution file, records the other
  names as `aliases`, and writes a `.poster.jpg` still for animated templates.
  Review merged groups in `data/duplicates.html`.
  The other members' files are kept too, as the template's `duplicates`.
  An animated and a static image are never duplicates: they're split into two
  templates that are each other's `variants`.
- Related templates that aren't duplicates become each other's `variants`: one is
  animated and the other not, one is some of the other's panels (3 vs 4 panels), their pictures share a layout but
  differ (recoloured…), or one name's words are all in the other's
  ("Three-headed Dragon" / "4 headed dragon"). They're listed in `data/duplicates.html` too.
- Duplicates the comparison misses (swapped panels, collages…) go under `same` in
  `scripts/duplicates.json`, and false matches under `different`, by imgflip id.
  Likewise, missed variants go under `variants` and false ones under `unrelated`.
  `npm run dedupe -- --explain <id>,<id>` shows why two images match or not.
- Frames are read from videos with the ffmpeg binary from `ffmpeg-static` (set
  `FFMPEG` to use another one).
- `extract:characters` cuts the character out of the templates listed in
  `scripts/characters.json` (a subject over sunburst slices or another flat or
  geometric background, a plain white one, line art…) and saves it as a transparent PNG,
  cropped to it, in `data/characters/`. Each entry of `data/characters/index.json`
  has the character's `id`, `name`, `file`, size and the `template` it comes from.
  Review them in `data/characters.html`. The background is flood-filled from the
  image's edges (`scripts/cutout.ts`), so when a cut-out is off, tune its entry:
  `edges` the subject is cut off by, `tolerance`, `drift` for gradient
  backgrounds, `holes: false` when the subject shares the background's colours,
  `lines` for the seams between slices, `erase`/`keep` rectangles, `seeds` for
  background the edges don't reach (behind a frame)…
  For line art on white, `close` closes gaps in the outlines so the fill doesn't
  leak inside, and `minSeed` keeps it from starting on lines that run into the
  edges. A template with several characters gets an entry for each, with its own
  `id`, `name` and the `crop` of the template it's in.
  Transparent templates are cut out like the others (over magenta).
  `npm run extract:characters -- --only <template id>` redoes some of them.

## Browse

```sh
npm start               # builds the client, then http://127.0.0.1:4321 (override with PORT / HOST)
```

A dependency-free Node server (`server/`) serving the page in `public/` (`index.html`
and `style.css`) and its script, compiled from `client/` to `dist/client/`, to search,
sort and view the templates in `data/templates/`, and to [make memes](#make-a-meme) of them. The viewer's alternatives panel
(button or <kbd>A</kbd>) lists the template's other formats (its duplicates, which a
switch can hide) and its variations. Thumbnails are rendered on demand
with sharp and cached in `data/thumbs/`.

The category menu filters the list: GIFs (animated templates), Complete (every
other template), Backgrounds (blank pages, plain colours), Formats (empty panel
layouts), Characters (the transparent cut-outs from `data/characters/`,
linked to their template as variants) and Diagrams (see below). Backgrounds and
Formats are listed by template id in `client/categories.ts`.

### Make a meme

“Edit” in the viewer (or <kbd>E</kbd>, or `#edit/<template id>` in the address bar) opens the
template on show in an editor, drawn on a canvas in the browser. It starts with a text at
the top and one at the bottom: type, and download.

- **Texts**: each has a field in the panel and a box on the picture. Drag the box to move
  it (it snaps to the middle of the picture, unless <kbd>Alt</kbd> is held), its corners to
  resize it and the handle above it to rotate it; the arrow keys nudge it, resize it with
  <kbd>Alt</kbd>, and <kbd>Delete</kbd> removes it. A text wraps in its box, and shrinks to fit it. Typing on a
  box, or double-clicking it, goes to its field.
- **Text style**: “Classic” (white Impact capitals with a black outline), “Plain” (black
  Arial) or “Label” (bold white with an outline), or its own font, size, colours, outline,
  alignment, capitals and rotation. “Apply style to all” gives it to every text.
- “Add caption above” adds white space over the picture with a plain text in it, the way
  memes are captioned nowadays. “Space around” sets that space on each side, and its colour.
- **Images** go on top, under the texts: a character from the Characters category, or
  uploaded, dropped or pasted ones. They’re moved, resized and rotated like the texts, and
  can be flipped.
- Undo and redo (<kbd>Ctrl</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>),
  “Copy” to the clipboard and “Download PNG”, at the picture’s own size or at a width.
- The meme is kept in the URL hash, so it can be bookmarked or shared (uploaded images stay
  local), and comes back when the template is edited again. The viewer’s alternatives are
  edited too: `f` in the hash is the duplicate’s file. Of an animated template, it’s the
  still that is edited: “Edit GIF on imgflip” captions the animation itself, in
  [imgflip’s GIF maker](https://imgflip.com/gif-maker).
- “Add text…” in the [background editor](#create-a-background) makes a meme of the
  background made there.
- “Create from image”, next to “Create background”, makes a meme of an image of your own,
  like a template; so does dropping one on the list, or pasting one (outside the search field). It stays local: it isn’t
  kept in the URL hash.

Impact is rarely installed outside Windows and macOS, so the page falls back on
[Anton](https://fonts.google.com/specimen/Anton), which looks like it, served from the
`@fontsource/anton` package (SIL Open Font License).

The model, its URL encoding, the fitting of texts, the geometry of layers and the drawing
are in `client/meme.ts` (DOM-free, tested), and the dialog in `client/meme-editor.ts`.

### Diagrams

The Diagrams category holds funny takes on the sample diagrams of the
[Mermaid live editor](https://mermaid.live), one per diagram type (a flowchart deciding
whether to deploy on Friday, a sequence diagram of a code review, a Venn diagram of fast,
cheap and good…). Each tile is named after its diagram type, and shows the diagram as
rendered by [mermaid.ink](https://mermaid.ink); the example's name is its alias. It opens
in the viewer like a template, with its formats as alternatives: a look (hand-drawn, neo)
or a theme (dark, forest, neutral), set in Mermaid's config. “Open original” opens the
SVG, “Download” saves a PNG, and “Edit in mermaid.live” opens the diagram, in the format
on show, in the editor. The diagram and its config travel in the links themselves, so it
works without any template. mermaid.ink turns away bursts of requests, so the page asks
for three pictures at a time, and tries again when turned away.

The examples and formats are in `client/diagrams.ts`. Each was checked against
Mermaid 12's parser and renderer, in every format: do the same for a new one by
pasting it in the editor.

### Create a background

“Create background” (or the “Create your own” tile heading the Backgrounds, or `#editor`
in the address bar) opens an editor for backgrounds
in the style of advice-animal templates, drawn on a canvas in the browser:

- Patterns: **sunburst** (slices from a centre point, colours in turn), **glow** (a
  radial gradient through its colours, with optional light rays), **split** (two halves,
  top/bottom or left/right, each with its own sunburst colours) and **solid**.
- Settings: up to 8 colours, slice count, rotation, uneven slice widths (seeded, with
  “Shuffle widths”), the centre (drag it on the preview or use the arrow keys), lines
  between slices, shading across each slice, darkened corners and the output size.
- “Start from a template’s look…” applies the look of a well-known template (Annoying
  Facebook Girl, Courage Wolf, Socially Awesome Awkward Penguin…).
- An image goes on top: a character from the Characters category, or an uploaded,
  dropped or pasted one (a PNG with a transparent background works best). Drag it to
  move it, and set its size and a white halo.
- “Download PNG” saves the result, and “Add text…” opens it in the
  [meme editor](#make-a-meme). The design is kept in the URL hash, so it can be
  bookmarked or shared (an uploaded image stays local).

The model, its URL encoding, the presets and the drawing are in `client/background.ts`
(DOM-free, tested), and the dialog in `client/editor.ts`.

## Development

Everything is TypeScript. Node ≥ 26 runs the server and scripts
directly by stripping types, so only the browser code in `client/` is compiled
(`npm run build`).

```sh
npm run lint            # ESLint (npm run lint:fix to fix)
npm run format:check    # Prettier (npm run format to fix)
npm run typecheck       # tsc, for Node and browser code
npm test                # node --test on every *.test.ts
```

CI (`.github/workflows/ci.yml`) runs all four on every push to `master` and every pull request.
