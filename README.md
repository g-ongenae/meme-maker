<img src="assets/icon.svg" width="64" height="64" alt="">

# meme-maker

Created in [T3 Code](https://t3.codes).

## Templates

```sh
npm install
npm run fetch:imgflip   # scrape all pages of imgflip.com/memetemplates → data/raw/imgflip/
npm run dedupe          # remove duplicates → data/templates/ (+ index.json)
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
- Related templates that aren't duplicates become each other's `variants`: one is
  some of the other's panels (3 vs 4 panels), their pictures share a layout but
  differ (recoloured…), or one name's words are all in the other's
  ("Three-headed Dragon" / "4 headed dragon"). They're listed in `data/duplicates.html` too.
- Duplicates the comparison misses (swapped panels, collages…) go under `same` in
  `scripts/duplicates.json`, and false matches under `different`, by imgflip id.
  Likewise, missed variants go under `variants` and false ones under `unrelated`.
  `npm run dedupe -- --explain <id>,<id>` shows why two images match or not.
- Frames are read from videos with the ffmpeg binary from `ffmpeg-static` (set
  `FFMPEG` to use another one).

## Browse

```sh
npm start               # builds the client, then http://127.0.0.1:4321 (override with PORT / HOST)
```

A dependency-free Node server (`server/`) serving the page in `public/` (`index.html`
and `style.css`) and its script, compiled from `client/` to `dist/client/`, to search,
sort and view the templates in `data/templates/`. The viewer's alternatives panel
(button or <kbd>A</kbd>) lists the template's other formats (its duplicates, which a
switch can hide) and its variations. Thumbnails are rendered on demand
with sharp and cached in `data/thumbs/`.

The category menu filters the list: GIFs (animated templates), Complete (every
other template), Backgrounds (blank pages, plain colours), Formats (empty panel
layouts) and Additions (elements such as faces, none yet). Backgrounds, Formats
and Additions are listed by template id in `client/categories.ts`.

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
