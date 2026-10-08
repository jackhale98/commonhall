/** Instant search over the palette index: every query word must match; titles that start with it rank first. */
export interface Searchable {
  k: string;
  t: string;
  s: string;
  h: string;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.’'"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const KIND_WEIGHT: Record<string, number> = {
  page: 6,
  state: 5,
  member: 4,
  councilor: 4,
  discussion: 3,
  bill: 2,
  'state-bill': 1,
};

interface Prepared<T> {
  item: T;
  title: string;
  hay: string;
  compact: string;
  /** Subtitle without spaces, e.g. "hr1" for "H.R. 1": exact matches rank first. */
  sub: string;
}

export function prepare<T extends Searchable>(items: T[]): Prepared<T>[] {
  return items.map((item) => {
    const title = normalize(item.t);
    const hay = `${title} ${normalize(item.s)}`;
    return { item, title, hay, compact: hay.replace(/ /g, ''), sub: normalize(item.s).replace(/ /g, '') };
  });
}

export function search<T extends Searchable>(index: Prepared<T>[], query: string, limit = 8): T[] {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const joined = words.join('');
  const scored: { item: T; score: number }[] = [];
  for (const p of index) {
    // "hr1" should find "H.R. 1": also try the query and the text without spaces.
    const all = words.every((w) => p.hay.includes(w)) || (joined.length > 1 && p.compact.includes(joined));
    if (!all) continue;
    let score = KIND_WEIGHT[p.item.k] ?? 0;
    if (p.title === words.join(' ')) score += 30;
    else if (p.title.startsWith(words[0]!)) score += 20;
    else if (p.title.includes(` ${words[0]}`)) score += 10;
    if (p.compact.startsWith(joined)) score += 8;
    if (p.sub === joined) score += 40;
    scored.push({ item: p.item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.item.t.localeCompare(b.item.t))
    .slice(0, limit)
    .map((s) => s.item);
}
