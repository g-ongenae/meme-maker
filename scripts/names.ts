// Name comparison used by dedupe.ts to find variants of a template ("Three-headed
// Dragon" / "4 headed dragon", "Marvel Civil War 1" / "Marvel Civil War 2").

// Words that say nothing about which picture a template is.
const STOPWORDS = new Set(
  `a an and are at be by for from i in is it me my no of oh on or the this to vs with yes you
   blank gif guy meme memes original template version`.split(/\s+/),
);
// Counts and ordinals: they are what tells variants apart, not what makes them related.
const NUMBER =
  /^(\d+(st|nd|rd|th|x\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth)$/;

export interface NameWords {
  /** Distinctive words: folded, singular, without stopwords or numbers. */
  words: Set<string>;
  /** Whether the name is a single word ("Squidward"). */
  single: boolean;
}

export function nameWords(name: string): NameWords {
  const all = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/'s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const words = all
    .filter((w) => !STOPWORDS.has(w) && !NUMBER.test(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  return { words: new Set(words), single: all.length === 1 };
}

/**
 * Whether two names designate variants of one template: the distinctive words
 * of one are all in the other, and make up at least half of it. A single
 * shared word is only enough when it is the whole of one name ("Squidward" /
 * "Squidward window"), since one word in common is usually a coincidence
 * ("Computer Guy" / "Computer Horse").
 */
export function similarNames(a: NameWords, b: NameWords): boolean {
  const [small, large] = a.words.size <= b.words.size ? [a, b] : [b, a];
  if (!small.words.size) return false;
  for (const w of small.words) if (!large.words.has(w)) return false;
  if (small.words.size === 1 && large.words.size > 1 && !small.single) return false;
  return small.words.size * 2 >= large.words.size;
}
