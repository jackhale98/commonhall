/**
 * Massachusetts governors' executive orders, as the Trial Court Law Libraries list
 * them on mass.gov: an index page per hundred ("Executive Orders 600-699") linking
 * each order ("No. 635: Affirming and Reconstituting …"), and a page per order
 * with its date, issuer and what it revokes. mass.gov refuses plain requests, so
 * the loader reads the pages in a browser and hands their text here.
 */

export const MA_ORDERS_INDEX = 'https://www.mass.gov/massachusetts-executive-orders';

export interface MaOrderLink {
  number: number;
  title: string;
  url: string;
}

export interface MaOrderDetail {
  signed_date: string | null;
  governor: string | null;
  revokes: string | null;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/ﬃ/g, 'ffi').replace(/ﬁ/g, 'fi').trim();

/** Index pages for each hundred ("…-600-699"), newest first, from the main index's links. */
export function maOrderRangePages(links: { text: string; href: string }[]): string[] {
  return links
    .filter((l) => /executive orders \d+-\d+/i.test(l.text))
    .map((l) => ({ href: l.href, from: Number(/(\d+)-\d+/.exec(l.text)![1]) }))
    .sort((a, b) => b.from - a.from)
    .map((l) => l.href);
}

/** Orders linked from an index page ("No. 635: Title"). */
export function parseMaOrderLinks(links: { text: string; href: string }[]): MaOrderLink[] {
  const out = new Map<number, MaOrderLink>();
  for (const l of links) {
    const m = /^No\.\s*(\d+)\s*[:.–-]\s*(.+)$/i.exec(clean(l.text));
    if (!m || !/\/executive-orders\//.test(l.href)) continue;
    const number = Number(m[1]);
    if (!out.has(number)) out.set(number, { number, title: clean(m[2]!), url: l.href });
  }
  return [...out.values()].sort((a, b) => a.number - b.number);
}

/** "08/15/2024" → "2024-08-15". */
function isoDate(us: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(us.trim());
  return m ? `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null;
}

/** An order page's text: "DATE:\t08/15/2024", "ISSUER:\tMaura Healey", "REVOKING AND SUPERSEDING:\t…". */
export function parseMaOrderDetail(text: string): MaOrderDetail {
  const field = (label: RegExp) => {
    const m = new RegExp(`^\\s*(?:${label.source}):\\s*\\n?\\s*(.+)$`, 'im').exec(text);
    return m ? clean(m[1]!) : null;
  };
  const date = field(/DATE/);
  return {
    signed_date: date ? isoDate(date) : null,
    governor: field(/ISSUER/),
    revokes: field(/REVOKING(?: AND SUPERSEDING)?|SUPERSEDING|REVOKING/),
  };
}
