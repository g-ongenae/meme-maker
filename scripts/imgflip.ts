// Parsing of imgflip's template listing, and where each template's original
// file lives. No I/O here, so it can be tested offline.

export interface ListedTemplate {
  id: string;
  name: string;
  slug: string;
  pageUrl: string;
  animated: boolean;
}

/** An entry of data/raw/imgflip/index.json. */
export interface RawTemplate extends ListedTemplate {
  rank: number;
  page?: number;
  url?: string;
  file?: string;
  thumbnailOnly?: boolean;
  error?: string;
}

export const decodeEntities = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// Each card looks like:
// <div class="mt-box"><h3 class="mt-title"><a ... href="/meme/Slug">Name</a></h3>
//   ... <img ... src="//i.imgflip.com/4/30b1gx.jpg"/> ...
//   [<div class="mt-animated-label">animated</div>]
export function parsePage(html: string): ListedTemplate[] {
  const cards = html.split('class="mt-box"').slice(1);
  return cards.flatMap((card) => {
    const title = card.match(/class="mt-title">\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/);
    const img = card.match(/<img[^>]*src="([^"]+)"/);
    if (!title || !img) return [];
    // Thumbnails live under /4/ (or /2/); the full-size image drops that prefix.
    // Some (restricted) entries use a relative /i-view/ URL instead; skip them.
    const m = img[1].match(/^\/\/i\.imgflip\.com\/\d+\/(\w+)\.\w+$/);
    if (!m) return [];
    return [
      {
        id: m[1],
        name: decodeEntities(title[2].trim()),
        slug: title[1].replace(/^\/meme\//, ''),
        pageUrl: `https://imgflip.com${title[1]}`,
        animated: card.includes('mt-animated-label'),
      },
    ];
  });
}

// The thumbnail is always .jpg, but the original may be .jpg, .png or .gif.
// Fall back to imgflip's larger /2/ thumbnail if none of those exist.
// Animated ("GIF") templates are only served as .mp4; a .jpg found for them is
// a 150×150 cropped still, so it is never used.
export const candidates = ({ id, animated }: Pick<ListedTemplate, 'id' | 'animated'>): string[] =>
  animated
    ? [`https://i.imgflip.com/${id}.mp4`]
    : [
        `https://i.imgflip.com/${id}.jpg`,
        `https://i.imgflip.com/${id}.png`,
        `https://i.imgflip.com/${id}.gif`,
        `https://i.imgflip.com/2/${id}.jpg`,
      ];

export const isThumbnailUrl = (url: string): boolean => url.includes('/2/');

export const fileFor = (id: string, url: string): string =>
  isThumbnailUrl(url) ? `${id}.thumb.jpg` : `${id}.${url.split('.').pop()}`;
