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
  /** "No. 1583". */
  register: string | null;
  /** The order's text: its WHEREAS clauses and what it orders, up to the signing line. */
  body: string | null;
}

/** A short summary of an order: what it does and why, in its own words, clipped. */
export interface MaOrderSummary {
  summary: string | null;
  reason: string | null;
}

/** Cut text at a sentence end near `max` characters, else at a word. */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf('. ');
  if (end > max / 2) return cut.slice(0, end + 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '')}…`;
}

/**
 * What an order does (the opening of what it orders, about 280 characters) and why
 * (its first WHEREAS clause, about 200), from its text.
 */
export function maOrderSummary(body: string): MaOrderSummary {
  const { whereas, sections } = maOrderParts(body);
  // The first section that says something: not definitions, not a lead-in to a list.
  const said = (s: { heading: string | null; text: string }, t: string) =>
    !/^definitions?\b/i.test(s.heading ?? '') &&
    !/^(definitions?|for (the )?purposes? of|as used in)\b|as used in this|following (terms|words)|shall have the following meanings?/i.test(
      t,
    ) &&
    !/:\s*$/.test(t);
  const first =
    sections.map((sec) => [sec, sec.text.split('\n\n')[0]!] as const).find(([sec, t]) => t && said(sec, t))?.[1] ??
    sections.find((s) => s.text)?.text.split('\n\n')[0] ??
    null;
  const why = whereas[0] ?? null;
  return {
    summary: first ? clipText(first, 280) : null,
    reason: why ? clipText(why.charAt(0).toUpperCase() + why.slice(1), 200) : null,
  };
}

/** An order's parts: why (its WHEREAS clauses) and what it orders, in sections. */
export interface MaOrderParts {
  whereas: string[];
  sections: { heading: string | null; text: string }[];
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
  // The text runs from the first WHEREAS (or the ordering clause) to the page's own
  // links ("THIS IS PART OF: …") and feedback form.
  // Orders that only amend another have no WHEREAS: their text follows the last
  // header field ("AMENDING:\tExecutive Order No. 631").
  const start = /^\s*(?:WHEREAS\b|NOW,? THEREFORE\b|By virtue of\b)/im.exec(text);
  const fields = [...text.matchAll(/^[ \t]*[A-Z][A-Z ,]{2,40}:[ \t]*\n?[ \t]*\S.*$/gm)].filter(
    (m) => !/^\s*THIS IS PART OF/.test(m[0]),
  );
  const from = start?.index ?? (fields.length ? fields.at(-1)!.index! + fields.at(-1)![0].length : -1);
  let body: string | null = null;
  if (from >= 0) {
    const rest = text.slice(from);
    const end = /^\s*(?:THIS IS PART OF:|Help Us Improve Mass\.gov)/im.exec(rest);
    body =
      (end ? rest.slice(0, end.index) : rest)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim() || null;
  }
  return {
    signed_date: date ? isoDate(date) : null,
    governor: field(/ISSUER/),
    revokes: field(/REVOKING(?: AND SUPERSEDING)?|SUPERSEDING|RESCINDING|REVOKING/),
    register: field(/MASS REGISTER/),
    body,
  };
}

/** Split an order's text into its WHEREAS clauses and its sections ("SECTION 1." or "Section 1. Purpose"). */
export function maOrderParts(body: string): MaOrderParts {
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const whereas: string[] = [];
  const sections: MaOrderParts['sections'] = [];
  let ordering = false;
  for (const p of paras) {
    if (!ordering && /^WHEREAS\b/i.test(p)) {
      whereas.push(p.replace(/^WHEREAS,?\s*/i, '').replace(/;\s*(and)?\s*$/i, '.'));
      continue;
    }
    if (!ordering && /^(NOW,? THEREFORE|By virtue of)\b/i.test(p)) {
      ordering = true;
      // "… do hereby order as follows: Executive Order No. 600 is rescinded." on one paragraph.
      const after = p.split(/order as follows:\s*/i)[1];
      if (after) sections.push({ heading: null, text: after });
      continue;
    }
    if (/^Given at the Executive Chamber\b/i.test(p)) break;
    // "SECTION 1." or "Section 1. Purpose", not prose like "Section 2 of Executive Order 631 is …".
    const heading = /^(SECTION|Section)\s+(\d+[A-Za-z]?)(?:\.\s*(.*)|\s*$)/.exec(p);
    if (heading) {
      const [, , n, rest] = heading;
      // "Section 1. Purpose" is a titled heading; a bare "SECTION 1." is followed by its text.
      const title = rest && rest.length < 80 && !/[.;:]\s/.test(rest) ? rest.replace(/\.$/, '') : '';
      sections.push({ heading: `Section ${n}${title ? `. ${title}` : ''}`, text: title ? '' : (rest ?? '') });
      continue;
    }
    const last = sections.at(-1);
    if (last && (last.text === '' || last.heading !== null)) last.text = last.text ? `${last.text}\n\n${p}` : p;
    else sections.push({ heading: null, text: p });
  }
  return { whereas, sections: sections.filter((s) => s.text || s.heading) };
}
