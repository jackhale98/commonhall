/**
 * Cambridge, MA City Council: what is the same whichever system the record came
 * from. The council used IQM2 (cambridgema.iqm2.com) through January 2026 and
 * PrimeGov (cambridgema.primegov.com) since, and the two cite the same file
 * differently ("POR 2025 #171" and "POR 2026-185"); both become one key here, so
 * an order filed in 2025 and acted on in 2026 is one matter.
 *
 * PrimeGov's "Final Actions" page for a council meeting lists every item with its
 * sponsors, result and roll call ("RESULT: Order Adopted [8-0-1]", "YEAS: Councillor
 * Al-Zubi, …"); `parseCambridgeActions` reads it (or the agenda, before the
 * meeting, which has no results).
 */
import { committeeSlug } from './boston-committees.ts';
import { markupText, monthDayYear, parseResult, splitNames } from './iqm2.ts';
import { ShapeError } from './shape.ts';

export const CAMBRIDGE = 'ma-cambridge';
/** IQM2 group (department) id of the City Council. */
export const CAMBRIDGE_COUNCIL_GROUP = 1000;
/** PrimeGov committee id of the City Council. */
export const CAMBRIDGE_COUNCIL_PRIMEGOV = 1;

/**
 * Kinds of council files we keep, by their citation prefix, with a number for the
 * matter key. Left out: public communications (COM, letters from residents, by
 * name; PrimeGov lists one bundle per meeting), applications and petitions (APP:
 * a resident's curb cut or sign, by address), communications from other officers
 * (COF) and the clerk's awaiting-report lists (AR, ARS).
 */
export const CAMBRIDGE_TYPES: Record<string, { code: number; type: string }> = {
  CMA: { code: 1, type: 'City Manager item' },
  POR: { code: 2, type: 'Policy order' },
  // Congratulations, condolences and commendations, adopted together in one vote.
  RES: { code: 3, type: 'Consent Agenda Resolution' },
  ORD: { code: 4, type: 'Ordinance' },
  CC: { code: 5, type: 'Committee report' },
};

export interface CambridgeCitation {
  prefix: string;
  year: number;
  number: number;
}

/** "POR 2025 #171", "ORD 2025 # 16", "POR 2026-185", "COM 3651 #2025" → prefix, year, number. */
export function parseCitation(text: string | null | undefined): CambridgeCitation | null {
  const s = (text ?? '').trim().toUpperCase();
  let m = /^([A-Z]{2,4})\s*(20\d{2})\s*(?:#|-)\s*(\d{1,5})$/.exec(s);
  if (m) return { prefix: m[1]!, year: Number(m[2]), number: Number(m[3]) };
  m = /^([A-Z]{2,4})\s*(\d{1,5})\s*#\s*(\d{4})$/.exec(s);
  if (m) return { prefix: m[1]!, year: Number(m[3]), number: Number(m[2]) };
  return null;
}

/** The citation at the start of an IQM2 agenda line: "CMA 2025 #305 : 12.22.25 Federal Update". */
export function citationOf(title: string): CambridgeCitation | null {
  const [head] = title.split(/\s+:\s+|\s*:\s*(?=[A-Za-z])/);
  return parseCitation(head);
}

/** The citation as shown: "POR 2025-171". */
export const citationLabel = (c: CambridgeCitation) => `${c.prefix} ${c.year}-${c.number}`;

/** The numeric matter key (code, year, number: POR 2026-185 → 220260185), or null for kinds we don't keep. */
export function cambridgeMatterNumber(c: CambridgeCitation): number | null {
  const kind = CAMBRIDGE_TYPES[c.prefix];
  if (!kind || c.number > 9999 || c.year < 2000 || c.year > 2099) return null;
  return kind.code * 100_000_000 + c.year * 10_000 + c.number;
}

/** "ma-cambridge-220260185", or null for kinds we don't keep. */
export function cambridgeMatterId(c: CambridgeCitation): string | null {
  const n = cambridgeMatterNumber(c);
  return n === null ? null : `${CAMBRIDGE}-${n}`;
}

// ---- Councillors ------------------------------------------------------------

/** "ma-cambridge-marc-mcgovern": first and last name (initials and middle names dropped). */
export function cambridgeOfficialId(name: string): string {
  const words = stripTitle(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z-]/g, '').replace(/^-+|-+$/g, ''))
    .filter((w) => w.length > 1);
  const parts = words.length > 2 ? [words[0], words.at(-1)] : words;
  return `${CAMBRIDGE}-${parts.join('-')}`;
}

/** "Councillor Patricia Nolan", "VICE MAYOR AZEEM", "Mayor Sumbul Siddiqui – 5:40 PM" → the name. */
export function stripTitle(name: string): string {
  return name
    .replace(/\s+[–-]\s+(\d{1,2}:\d{2}\s*[AP]M|REMOTE)\b.*$/i, '')
    .replace(/^(vice\s+mayor|mayor|council+or|council\s+member)\s+/i, '')
    .trim();
}

/** The last name, lower case ("Sobrinho-Wheeler" → "sobrinho-wheeler"). */
export function surname(name: string): string {
  const words = stripTitle(name)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && !/^(jr|sr|ii|iii)\.?$/.test(w));
  return (words.at(-1) ?? '').replace(/[^a-z-]/g, '');
}

/**
 * Finds councillors by name as the records print them: a full name with or without
 * a middle initial ("Marc C. McGovern", "Marc McGovern"), or only a title and last
 * name ("COUNCILLOR MCGOVERN"). A last name must belong to exactly one person.
 */
export class CouncillorIndex {
  private readonly byId = new Map<string, { id: string; name: string }>();

  constructor(people: { id: string; name: string }[] = []) {
    for (const p of people) this.add(p.id, p.name);
  }

  add(id: string, name: string) {
    if (!this.byId.has(id)) this.byId.set(id, { id, name });
  }

  get people() {
    return [...this.byId.values()];
  }

  /** The id for a printed name, or null when it matches nobody (or two people). */
  find(printed: string): string | null {
    const full = cambridgeOfficialId(printed);
    if (this.byId.has(full)) return full;
    const last = surname(printed);
    if (!last) return null;
    const exact = this.people.filter((p) => surname(p.name) === last);
    if (exact.length) return exact.length === 1 ? exact[0]!.id : null;
    // A hyphenated name printed with a space ("SOBRINHO WHEELER").
    const letters = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '');
    const whole = letters(stripTitle(printed));
    const joined = this.people.filter(
      (p) => letters(surname(p.name)).length > 3 && whole.endsWith(letters(surname(p.name))),
    );
    if (joined.length === 1) return joined[0]!.id;
    // The clerk's typos ("SIDDIQUII", "AL-ZUB"): one letter off, when only one person is that close.
    const near = this.people.filter((p) => oneEditApart(surname(p.name), last));
    return last.length >= 5 && near.length === 1 ? near[0]!.id : null;
  }
}

/** True when two words differ by one letter added, dropped or changed. */
export function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// ---- Meetings and committees ------------------------------------------------

/** The council's standing committees (IQM2 and PrimeGov name them slightly differently). */
export const CAMBRIDGE_COMMITTEES = [
  'Ordinance Committee',
  'Finance Committee',
  'Government Operations, Rules and Claims Committee',
  'Housing Committee',
  'Economic Development and University Relations Committee',
  'Human Services and Veterans Committee',
  'Health and Environment Committee',
  'Neighborhood and Long Term Planning, Public Facilities, Arts and Celebration Committee',
  'Transportation and Public Utilities Committee',
  'Civic Unity Committee',
  'Public Safety Committee',
] as const;

const COMMITTEE_KEYS: [RegExp, string][] = [
  [/ordinance/i, 'Ordinance Committee'],
  [/finance/i, 'Finance Committee'],
  [/government operations/i, 'Government Operations, Rules and Claims Committee'],
  [/housing/i, 'Housing Committee'],
  [/economic development/i, 'Economic Development and University Relations Committee'],
  [/human services/i, 'Human Services and Veterans Committee'],
  [/health/i, 'Health and Environment Committee'],
  [/neighborhood/i, 'Neighborhood and Long Term Planning, Public Facilities, Arts and Celebration Committee'],
  [/transportation/i, 'Transportation and Public Utilities Committee'],
  [/civic unity/i, 'Civic Unity Committee'],
  [/public safety/i, 'Public Safety Committee'],
];

export const cambridgeCommitteeSlug = (name: string) => committeeSlug(name);

/**
 * What a meeting is, from its body or title: the full council (committees empty),
 * one or more of its committees (a joint meeting names several), or null for
 * boards and commissions, which aren't the council. Also whether it was cancelled.
 */
export function cambridgeMeetingKind(title: string): { committees: string[] | null; cancelled: boolean } {
  const cancelled = /cancel+ed/i.test(title);
  const t = title.replace(/[-–]?\s*cancel+ed\s*[-–]?/gi, ' ').trim();
  if (/do not use/i.test(t)) return { committees: null, cancelled };
  // Committees of the council (not "Citizens' Committee on Civic Unity" or a board's committee).
  if (/committee/i.test(t) && !/city council|citizens|screening|advisory|preservation|benefits/i.test(t)) {
    const found = COMMITTEE_KEYS.filter(([re]) => re.test(t)).map(([, name]) => name);
    return { committees: found.length ? found : null, cancelled };
  }
  // Joint meetings of committees named without the word (PrimeGov: "Transportation and Public Utilities").
  if (/^(the\s+)?(transportation and public utilities|economic development and university relations)\b/i.test(t))
    return { committees: COMMITTEE_KEYS.filter(([re]) => re.test(t)).map(([, n]) => n), cancelled };
  if (/city council|council meeting|round\s?table|special meeting of the city council/i.test(t))
    return { committees: [], cancelled };
  // IQM2's council meeting types ("Regular Meeting", "Special Meeting", "Public Hearing", …).
  if (
    /^(regular|special|inaugural|roundtable\/working|round\s?table|public hearing)\b.*meeting|^public hearing$/i.test(t)
  )
    return { committees: [], cancelled };
  return { committees: null, cancelled };
}

// ---- PrimeGov agendas and final actions ------------------------------------

export interface CambridgeItemVote {
  result: string;
  yes: number | null;
  no: number | null;
  /** A voice vote ("[VV9]"): no names recorded. */
  voice: boolean;
  yeas: string[];
  nays: string[];
  present: string[];
  absent: string[];
}

export interface CambridgeAgendaItem {
  /** The agenda section, e.g. "POLICY ORDERS". */
  section: string;
  /** Position on the agenda, from 1. */
  seq: number;
  citation: CambridgeCitation;
  title: string;
  /** As printed: "COUNCILLOR SOBRINHO-WHEELER". */
  sponsors: string[];
  /** Notes above the citation: "CHARTER RIGHT EXERCISED BY COUNCILLOR ZUSY IN COUNCIL …". */
  notes: string[];
  vote: CambridgeItemVote | null;
}

export interface CambridgeMeetingRecord {
  kind: 'agenda' | 'final actions';
  /** YYYY-MM-DD from the heading ("FINAL ACTIONS ● OCTOBER 05, 2026"). */
  date: string | null;
  /** The roll call at the start of the meeting (final actions only). */
  present: string[];
  absent: string[];
  items: CambridgeAgendaItem[];
}

/** The text lines of a PrimeGov meeting page: scripts, icons and attachment links dropped. */
export function primeGovLines(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<a\b[\s\S]*?<\/a>/gi, '')
    .replace(/<\/p>|<br\s*\/?>|<\/div>|<\/tr>|<\/td>|<\/h\d>|<\/li>/gi, '\n');
  return text
    .split('\n')
    .map((l) => markupText(l))
    .filter((l) => l && !/^(combine item's attachments|view item details)/i.test(l));
}

const CITATION_LINE = /^[A-Z]{2,4}\s+\d{4}\s*-\s*\d{1,5}$/;
const SPONSOR_LINE = /^(VICE MAYOR|MAYOR|COUNCIL+OR)\s+[A-Z][A-Z' .-]*$/;
const ROLE_LINE = /^(RESULT|YEAS|NAYS|PRESENT|ABSENT|RECUSED):\s*(.*)$/i;
const NUMBER_LINE = /^(\d{1,3})\.$/;
const ROMAN_LINE = /^[IVXL]+\.$/;

function parseItemVote(roles: Map<string, string>): CambridgeItemVote | null {
  const result = roles.get('RESULT');
  if (!result) return null;
  const voice = /\[\s*VV\s*\d*\s*\]/i.test(result);
  return {
    ...parseResult(result),
    voice,
    yeas: splitNames(roles.get('YEAS')),
    nays: splitNames(roles.get('NAYS')),
    present: splitNames(roles.get('PRESENT')),
    absent: splitNames(roles.get('ABSENT')),
  };
}

/**
 * A council meeting's agenda or final actions from PrimeGov's web page. Items are
 * numbered within sections; an item is kept when it ends in a citation
 * ("POR 2026-185"). Throws when the page has no heading or nothing that looks
 * like an item, so a changed layout fails instead of looking like a quiet meeting.
 */
export function parseCambridgeActions(html: string): CambridgeMeetingRecord {
  const lines = primeGovLines(html);
  const heading = lines.find((l) => /^(FINAL ACTIONS|AGENDA)\s*●/i.test(l));
  if (!heading) throw new ShapeError('Cambridge PrimeGov meeting page', ['no "AGENDA ●" or "FINAL ACTIONS ●" heading']);
  const kind = /^FINAL ACTIONS/i.test(heading) ? 'final actions' : 'agenda';
  const record: CambridgeMeetingRecord = {
    kind,
    date: monthDayYear(heading.replace(/^[^●]*●\s*/, '')),
    present: [],
    absent: [],
    items: [],
  };

  let i = lines.indexOf(heading) + 1;
  // Roll call: "Present:" then names, "Absent:" then names.
  const roll = lines.findIndex((l, n) => n >= i && /^present:$/i.test(l));
  if (roll >= 0 && roll < i + 40) {
    let into: string[] = record.present;
    for (let n = roll + 1; n < lines.length; n++) {
      const l = lines[n]!;
      if (/^absent:$/i.test(l)) {
        into = record.absent;
        continue;
      }
      if (ROMAN_LINE.test(l) || NUMBER_LINE.test(l) || /^[A-Z ]+$/.test(l)) break;
      if (!/^none$/i.test(l)) into.push(l);
    }
  }

  let section = '';
  let seq = 0;
  let sawNumbered = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (ROMAN_LINE.test(line)) {
      section = lines[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (!NUMBER_LINE.test(line)) {
      // Unnumbered sub-headings ("CHARTER RIGHT", "UNFINISHED BUSINESS") between items.
      if (/^[A-Z][A-Z ,&'/-]+$/.test(line) && !SPONSOR_LINE.test(line) && line.length < 60) section = line;
      continue;
    }
    sawNumbered += 1;
    // An item: text, sponsors and notes, then its citation, then the result.
    const title: string[] = [];
    const sponsors: string[] = [];
    const notes: string[] = [];
    let citation: CambridgeCitation | null = null;
    let n = i + 1;
    for (; n < lines.length; n++) {
      const l = lines[n]!;
      if (NUMBER_LINE.test(l) || ROMAN_LINE.test(l) || ROLE_LINE.test(l)) break;
      if (CITATION_LINE.test(l)) {
        citation = parseCitation(l);
        n += 1;
        break;
      }
      if (SPONSOR_LINE.test(l) && !/EXERCISED|IN COUNCIL/.test(l)) sponsors.push(l);
      else if (!/[a-z]/.test(l) && l.length > 2 && title.length > 0) notes.push(l);
      else title.push(l);
    }
    const roles = new Map<string, string>();
    for (; n < lines.length; n++) {
      const m = ROLE_LINE.exec(lines[n]!);
      if (!m) break;
      let value = m[2]!.trim();
      if (!value && n + 1 < lines.length && !ROLE_LINE.test(lines[n + 1]!) && !NUMBER_LINE.test(lines[n + 1]!)) {
        value = lines[n + 1]!;
        n += 1;
      }
      roles.set(m[1]!.toUpperCase(), value);
    }
    i = n - 1;
    if (!citation || title.length === 0) continue;
    seq += 1;
    record.items.push({
      section,
      seq,
      citation,
      title: title.join(' '),
      sponsors,
      notes: notes.length ? [notes.join(' ')] : [],
      vote: parseItemVote(roles),
    });
  }
  if (sawNumbered >= 3 && record.items.length === 0)
    throw new ShapeError('Cambridge PrimeGov meeting page', [`${sawNumbered} numbered items, none with a citation`]);
  return record;
}
