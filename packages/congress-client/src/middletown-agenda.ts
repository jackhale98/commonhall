/**
 * Middletown, Connecticut's Common Council agendas, from the city's CivicPlus
 * Agenda Center (middletownct.gov/AgendaCenter):
 *
 *  - The listing: POST /AgendaCenter/UpdateCategoryList with `year` and `catID`
 *    (the Common Council is 14) returns an HTML table, one row per posting: the
 *    meeting date ("Agenda for October 5, 2026"), a title ("Common Council - Regular
 *    Meeting (PDF)"), the agenda PDF (/AgendaCenter/ViewFile/Agenda/_10052026-11755)
 *    and, once approved, the minutes PDF. The number after the date identifies the
 *    posting; an amended agenda keeps it.
 *  - The agenda: a text PDF read with `pdftotext -layout`. Numbered sections ("11.
 *    Resolutions, Ordinances, etc.") of lettered items ("A. Approving that …"),
 *    sometimes with roman-numbered sub-items ("i. Approving Bond Ordinance …").
 *    Each page repeats a header ("OCTOBER 5, 2026   COMMON COUNCIL -- REGULAR
 *    MEETING   Page 2"); a filing path ("K: review/ agenda/ …") closes it.
 *
 * Matters are the items in three sections: Resolutions and Ordinances, Old Business
 * (items carried from earlier meetings, often cited by number: "RESOLUTION No.
 * 81-26") and Appropriations. Resolutions get their numbers when adopted, so a new
 * item has none on the agenda; ordinances are sometimes numbered ahead.
 */

export const MIDDLETOWN_AGENDA_CENTER = 'https://www.middletownct.gov/AgendaCenter';
export const MIDDLETOWN_COUNCIL_CATEGORY = 14;

export interface AgendaPosting {
  /** The posting's number ("11755"). */
  id: number;
  /** YYYY-MM-DD. */
  date: string;
  /** "Common Council - Regular Meeting". */
  title: string;
  agendaUrl: string;
  minutesUrl: string | null;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** "October 5, 2026" → "2026-10-05". */
export function longDate(text: string): string | null {
  const m = /([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.startsWith(m[1]!.toLowerCase().slice(0, 3)));
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The postings in an Agenda Center listing, by posting number (a number listed twice is kept once). */
export function parseAgendaCenterList(html: string, site = 'https://www.middletownct.gov'): AgendaPosting[] {
  const out = new Map<number, AgendaPosting>();
  for (const row of html.split(/<tr[^>]+class="catAgendaRow"[^>]*>/).slice(1)) {
    const body = row.split(/<\/tr>/)[0]!;
    const date = longDate(/aria-label="Agenda for ([^"]+)"/.exec(body)?.[1] ?? '');
    const link = /<a[^>]+href="(\/AgendaCenter\/ViewFile\/Agenda\/_(\d{8})-(\d+))"[^>]*>([\s\S]*?)<\/a>/.exec(body);
    if (!date || !link) continue;
    const id = Number(link[3]);
    if (out.has(id)) continue;
    const minutes = /href="(\/AgendaCenter\/ViewFile\/Minutes\/_\d{8}-\d+)"/.exec(body)?.[1];
    out.set(id, {
      id,
      date,
      title: decode(link[4]!)
        .replace(/\s*\(PDF\)\s*$/i, '')
        .replace(/\s+/g, ' '),
      agendaUrl: `${site}${link[1]}`,
      minutesUrl: minutes ? `${site}${minutes}` : null,
    });
  }
  return [...out.values()];
}

export interface MiddletownItem {
  /** "11A", or "3A.ii" for a sub-item. */
  number: string;
  /** "Resolutions, Ordinances, etc." */
  section: string;
  text: string;
}

export interface MiddletownAgenda {
  /** "7:00 PM", from the cover. */
  time: string | null;
  /** Every lettered item, matter or not (a short list means the layout changed). */
  items: MiddletownItem[];
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const PAGE_HEADER = /^\s*[A-Z]+\s+\d{1,2},\s+\d{4}\s{2,}.*\bPage\s+\d+\s*$/;
const FILING = /^\s*K:\s*review\b/i;
const SECTION = /^\s{0,3}(\d{1,2})\.\s+(\S.*)$/;
const ITEM = /^\s{1,10}([A-Z])\.\s+(\S.*)$/;
const SUB = /^\s{3,}(i{1,3}|iv|vi{0,3}|ix|x)\.\s+(\S.*)$/;

/** "Appropriations: Mayor requests …" → "Appropriations"; "Call to Order NOTE: …" → "Call to Order". */
export function sectionName(raw: string): string {
  return squash(raw.split(/\s*(?::|\s--\s|\s[–—]\s|\bNOTE\b)/)[0]!) || squash(raw);
}

/** The cover's time and the agenda's lettered items, in order. */
export function parseMiddletownAgenda(text: string): MiddletownAgenda {
  const lines = text.replace(/\f/g, '\n').split('\n');
  const clock = lines
    .slice(0, 40)
    .map((l) => /\b(\d{1,2}):(\d{2})\s*([AP])\.?\s*M\b/i.exec(l))
    .find(Boolean);
  const time = clock ? `${Number(clock[1])}:${clock[2]} ${clock[3]!.toUpperCase()}M` : null;
  const items: MiddletownItem[] = [];
  let section = '';
  let sectionNo = '';
  let current: MiddletownItem | null = null;
  let parent: MiddletownItem | null = null;
  for (const raw of lines) {
    if (!raw.trim() || PAGE_HEADER.test(raw)) continue;
    if (FILING.test(raw)) break;
    const sec = SECTION.exec(raw);
    if (sec) {
      sectionNo = sec[1]!;
      section = sectionName(sec[2]!);
      current = null;
      parent = null;
      continue;
    }
    if (!sectionNo) continue;
    const item = ITEM.exec(raw);
    if (item) {
      current = { number: `${sectionNo}${item[1]}`, section, text: squash(item[2]!) };
      parent = current;
      items.push(current);
      continue;
    }
    const sub = parent ? SUB.exec(raw) : null;
    if (sub && parent) {
      current = { number: `${parent.number}.${sub[1]}`, section, text: squash(sub[2]!) };
      items.push(current);
      continue;
    }
    if (current) current.text = squash(`${current.text} ${raw}`);
  }
  return { time, items };
}

export interface MiddletownMatter {
  type: 'Resolution' | 'Ordinance' | 'Appropriation';
  /** "Resolution No. 81-26" when the agenda cites one. */
  number: string | null;
  title: string;
  /** The section, named the same way at every meeting. */
  section: 'Resolutions and Ordinances' | 'Old Business' | 'Appropriations';
}

const TITLE_LIMIT = 1500;

/** Which items are council matters, with their type and number; null for the rest. */
export function classifyMiddletownItem(item: MiddletownItem, all: MiddletownItem[] = []): MiddletownMatter | null {
  const section = item.section.toLowerCase();
  const appropriation = /^appropriations?\b/.test(section);
  if (!appropriation && !/^(resolutions?|ordinances?)\b/.test(section) && !/^old business/.test(section)) return null;
  // A heading over sub-items ("A. Bond Ordinance Appropriations" over "i.", "ii.") isn't an item itself.
  if (all.some((o) => o.number.startsWith(`${item.number}.`)) && item.text.length < 120) return null;
  const text = item.text;
  if (!text || /^(none|no items?)\b/i.test(text)) return null;
  const cited = /^(RESOLUTION|ORDINANCE)\s+No[.:]?\s*(\d{1,3})\s*-\s*(\d{2})\b/i.exec(text);
  let title = text;
  if (cited) title = text.slice(cited[0].length).replace(/^\s*[-–—:;,]+\s*/, '') || text;
  if (title.length > TITLE_LIMIT) title = `${title.slice(0, TITLE_LIMIT).replace(/\s+\S*$/, '')} …`;
  const type: MiddletownMatter['type'] = appropriation
    ? 'Appropriation'
    : cited
      ? cited[1]!.toUpperCase() === 'ORDINANCE'
        ? 'Ordinance'
        : 'Resolution'
      : /^(an\s+)?ordinance\b|^approving (a |the )?(bond )?ordinance\b/i.test(text)
        ? 'Ordinance'
        : 'Resolution';
  return {
    type,
    section: appropriation
      ? 'Appropriations'
      : /^old business/.test(section)
        ? 'Old Business'
        : 'Resolutions and Ordinances',
    number: cited ? `${type === 'Ordinance' ? 'Ordinance' : 'Resolution'} No. ${Number(cited[2])}-${cited[3]}` : null,
    title,
  };
}
