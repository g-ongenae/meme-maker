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
  to `.png`/`.gif` when the `.jpg` doesn't exist). It's resumable: already-downloaded
  files are skipped.
- `dedupe` groups visually identical images (perceptual dHash + colour thumbnail +
  aspect ratio), keeps the most popular name and the highest-resolution file, and
  records the other names as `aliases`. Review merged groups in `data/duplicates.html`.
