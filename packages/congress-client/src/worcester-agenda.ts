/**
 * Worcester City Council agendas from PrimeGov: the items on each meeting's
 * agenda (orders, resolutions, petitions, City Manager communications, committee
 * reports, hearings), read from the agenda's HTML (meetings before mid-2026) or its
 * PDF as `pdftotext -layout` text (later meetings publish only PDFs).
 *
 * Agendas are numbered sections ("12. ORDERS") of lettered items ("12a. Request
 * City Manager …"), with a line before a run of items saying what the council is
 * asked to do with them ("9a - 9k Refer to Traffic and Parking Committee").
 * Sponsors appear as "ORDER of Councilor Khrystian E. King - …" (older agendas),
 * "Councilor X on behalf of Y request …" (petitions) or a closing "(Rivera)".
 */

export interface AgendaItem {
  /** "12a". */
  number: string;
  /** "ORDERS", "PETITIONS - a Petitioner may speak …". */
  section: string;
  text: string;
  /** What the council is asked to do: "Refer to Traffic and Parking Committee", "Adopt". */
  action: string | null;
}

export interface ClassifiedItem {
  type: string;
  title: string;
  /** Full names ("Khrystian E. King") or surnames ("Rivera"). */
  sponsors: string[];
}

const NUM = String.raw`\d{1,2}(?:\.\d{1,2})?[a-z]{1,2}`;
const ITEM = new RegExp(String.raw`^\s*(${NUM})\.\s*(.*)$`);
const SECTION = /^\s{0,8}(\d{1,2})\.\s+([A-Z][A-Z'’]+(?:[\s,&()/-]+[A-Z'’]+)*\b.*)$/;
const ACTION = new RegExp(String.raw`^\s*(${NUM})(?:\s*-\s*(${NUM}))?\s+([A-Z][a-z].*)$`);

/** "12b" → ["12", 2]; "9aa" → ["9", 27]; "11.35a" → ["11.35", 1]. */
function rank(n: string): [string, number] {
  const [, num, letters] = /^([\d.]+)([a-z]+)$/.exec(n)!;
  let r = 0;
  for (const ch of letters!) r = r * 26 + (ch.charCodeAt(0) - 96);
  return [num!, r];
}

const inRange = (n: string, from: string, to: string) => {
  const [a, x] = rank(n);
  const [b, lo] = rank(from);
  const [, hi] = rank(to);
  return a === b && x >= lo && x <= hi;
};

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Items from an agenda's `pdftotext -layout` text, in agenda order. */
export function parseAgendaText(text: string): AgendaItem[] {
  const items: AgendaItem[] = [];
  let section = '';
  let inHeading = false;
  let actions: { from: string; to: string; action: string }[] = [];
  let current: AgendaItem | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s{2,}Attachments\s*$/, '').replace(/\f/g, '');
    if (!line.trim() || /^\s*Attachments\s*$/.test(line)) continue;
    const item = ITEM.exec(line);
    if (item) {
      const number = item[1]!;
      const action = actions.find((a) => inRange(number, a.from, a.to));
      current = { number, section, text: item[2]!.trim(), action: action?.action ?? null };
      items.push(current);
      inHeading = false;
      continue;
    }
    const act = ACTION.exec(line);
    if (act) {
      actions.push({ from: act[1]!, to: act[2] ?? act[1]!, action: squash(act[3]!) });
      current = null;
      inHeading = false;
      continue;
    }
    const sec = SECTION.exec(line);
    if (sec) {
      section = squash(sec[2]!);
      actions = [];
      current = null;
      inHeading = true;
      continue;
    }
    if (current) current.text += ` ${line.trim()}`;
    else if (inHeading) section += ` ${line.trim()}`;
  }
  return items.map((i) => ({ ...i, text: squash(i.text), section: squash(i.section) }));
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&#8217;/g, '’')
    .replace(/&quot;|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&ndash;|&#8211;/g, '–')
    .replace(/&nbsp;/g, ' ');

/** Items from an agenda's HTML page (PrimeGov's compiled HTML agenda), in agenda order. */
export function parseAgendaHtml(html: string): AgendaItem[] {
  const items: AgendaItem[] = [];
  let section = '';
  const re =
    /<tr class='section-row'><td colspan='2'>([\s\S]*?)<\/td>|<div class='agenda-item' id='AgendaItem_\d+'>([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) {
      section = squash(decode(m[1]).replace(/^\d{1,2}(?:\.\d{1,2})?\.\s*/, ''));
      continue;
    }
    const text = squash(decode(m[2]!));
    const item = ITEM.exec(text);
    if (item) items.push({ number: item[1]!, section, text: item[2]!.trim(), action: null });
  }
  return items;
}

const TYPES: [RegExp, string][] = [
  [/^CHAIRMAN'?’?S ORDERS?|^ORDERS?\b/, 'Order'],
  [/RESOLUTION/, 'Resolution'],
  [/^PETITIONS?\b/, 'Petition'],
  [/^HEARINGS?\b/, 'Hearing'],
  [/^COMMUNICATIONS? OF THE CITY MANAGER/, 'City Manager communication'],
  [/^COMMUNICATIONS?\b/, 'Communication'],
  [/^REPORTS? OF\b/, 'Committee report'],
  [/^TO BE ORDAINED/, 'Ordinance'],
  [/^RECONSIDERATION/, 'Reconsideration'],
];

const PERSON = String.raw`(?:Councilor|Mayor)\s+[A-Z][\w.'’]*(?:\s+[A-Z][\w.'’]*)*?`;
const PEOPLE = String.raw`${PERSON}(?:(?:\s*,\s*|\s+and\s+)${PERSON})*`;
/** "ORDER of Councilor A and Councilor B - …", "Councilor A on behalf of …", "ORDER of Councilor A Request …". */
const LEAD = new RegExp(
  String.raw`^(?:(?:ORDER|RESOLUTION|PETITION) of\s+)?(${PEOPLE})(?:\s*[-–]\s*|\s+(?=on behalf of\b|requests?\b|Request\b|That\b|In accordance\b|Due\b))`,
);
const ONE = new RegExp(String.raw`(?:Councilor|Mayor)\s+([A-Z][\w.'’]*(?:\s+[A-Z][\w.'’]*)*?)(?=\s*,|\s+and\s|$)`, 'g');
const TAIL = /\s*\(([A-Z][a-z’'-]+(?:(?:,\s*|\s+and\s+)[A-Z][a-z’'-]+)*)\)\s*\.?$/;

/** An agenda item's type, its title without the procedural lead-in, and its sponsors; null for procedure. */
export function classifyAgendaItem(item: AgendaItem): ClassifiedItem | null {
  const text = item.text;
  if (!text || /^number not used/i.test(text)) return null;
  let type = /^ORDER of\b/i.test(text)
    ? 'Order'
    : /^RESOLUTION of\b/i.test(text)
      ? 'Resolution'
      : /^PETITION of\b/i.test(text)
        ? 'Petition'
        : /^COMMUNICATION of the City Manager\b/i.test(text)
          ? 'City Manager communication'
          : /^(REPORT OF|FROM THE COMMITTEE)\b/i.test(text)
            ? 'Committee report'
            : (TYPES.find(([re]) => re.test(item.section.toUpperCase()))?.[1] ?? null);
  // Committee recommendations adopted as orders ("10a. FROM THE COMMITTEE ON … - Request …").
  if (/^FROM THE COMMITTEE\b/i.test(text) && /ORDER/i.test(item.section)) type = 'Order';
  if (/^FROM THE COMMITTEE\b/i.test(text) && /RESOLUTION/i.test(item.section)) type = 'Resolution';
  if (!type) return null;

  const sponsors: string[] = [];
  const lead = type === 'Committee report' ? null : LEAD.exec(text);
  if (lead) for (const m of lead[1]!.matchAll(ONE)) sponsors.push(squash(m[1]!));
  const tail = TAIL.exec(text);
  if (tail) sponsors.push(...tail[1]!.split(/,\s*|\s+and\s+/));

  // Orders and resolutions read better without "ORDER of Councilor X -"; petitions keep who asked.
  let title = text;
  if (lead && /^(ORDER|RESOLUTION) of\b/i.test(text)) title = text.slice(lead[0].length);
  title = squash(title.replace(TAIL, ''));
  return { type, title: title || text, sponsors: [...new Set(sponsors)] };
}
