import { billLabel, ordinal } from '@civic/congress-client/ids';
import { STATUS_LABELS, type BillStatus } from '@civic/congress-client/status';

const STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
  PR: 'Puerto Rico',
  GU: 'Guam',
  VI: 'U.S. Virgin Islands',
  AS: 'American Samoa',
  MP: 'Northern Mariana Islands',
};

export const STATE_CODES = Object.keys(STATES);
/** The 50 states plus DC, which have Open States legislatures. */
export const LEGISLATURE_STATES = STATE_CODES.filter((c) => !['PR', 'GU', 'VI', 'AS', 'MP'].includes(c));

export function stateName(code: string | null | undefined): string {
  if (!code) return '';
  return STATES[code.toUpperCase()] ?? code;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** `2026-10-06` → `Oct 6, 2026`. Dates are calendar dates, so format in UTC. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? value : dateFormatter.format(d);
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York',
  timeZoneName: 'short',
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateTimeFormatter.format(d);
}

export function partyLetter(party: string | null | undefined): string {
  return (party ?? '').charAt(0).toUpperCase();
}

export function partyClass(party: string | null | undefined): string {
  const p = partyLetter(party);
  return p === 'D' ? 'party-d' : p === 'R' ? 'party-r' : p ? 'party-i' : '';
}

export function partyLabel(party: string | null | undefined): string {
  switch (partyLetter(party)) {
    case 'D':
      return 'Democrat';
    case 'R':
      return 'Republican';
    case 'I':
      return 'Independent';
    case 'L':
      return 'Libertarian';
    default:
      return party ?? 'Unknown party';
  }
}

/** `R-TX-19`, `D-WA` */
export function memberTag(m: {
  party: string | null;
  state: string | null;
  district: number | null;
  chamber: string | null;
}): string {
  const parts = [partyLetter(m.party) || '?', m.state ?? ''];
  if (m.chamber === 'house') parts.push(m.district === 0 ? 'AL' : String(m.district ?? ''));
  return parts.filter(Boolean).join('-');
}

/** "Senator from Washington" / "Representative for Texas's 19th district" */
export function memberRole(m: {
  chamber: string | null;
  state: string | null;
  district: number | null;
  current?: boolean;
}): string {
  const state = stateName(m.state);
  if (m.chamber === 'senate') return `${m.current === false ? 'Former senator' : 'Senator'} from ${state}`;
  const delegate = ['DC', 'PR', 'GU', 'VI', 'AS', 'MP'].includes(m.state ?? '');
  const title = m.state === 'PR' ? 'Resident Commissioner' : delegate ? 'Delegate' : 'Representative';
  const prefix = m.current === false ? `Former ${title.toLowerCase()}` : title;
  if (delegate) return `${prefix} for ${state}`;
  if (m.district === 0) return `${prefix} for ${state} (at large)`;
  return `${prefix} for ${state}’s ${ordinal(m.district ?? 0)} district`;
}

export function statusLabel(status: BillStatus | string): string {
  return STATUS_LABELS[status as BillStatus] ?? status;
}

export function billDisplayTitle(b: { short_title: string | null; title: string }): string {
  return b.short_title?.trim() || b.title;
}

export function billNumberLabel(b: { bill_type: string; number: number }): string {
  return billLabel(b.bill_type, b.number);
}

export function congressLabel(congress: number): string {
  return `${ordinal(congress)} Congress`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((p) => /^[A-Za-z]/.test(p))
    .map((p) => p[0]!.toUpperCase())
    .filter((_, i, all) => i === 0 || i === all.length - 1)
    .join('');
}

/** Split stored plain-text summaries into paragraphs and list items. */
export function paragraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/**
 * Titles some legislatures publish in capitals ("AN ACT TO AMEND TITLE 15 OF THE
 * DELAWARE CODE…") in title case, which is easier to read; anything with lower-case
 * letters is left as written.
 */
export function tidyTitle(title: string): string {
  if (/[a-z]/.test(title) || !/[A-Z]{4}/.test(title)) return title;
  return title
    .toLowerCase()
    .split(/(\s+)/)
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word)
        ? word
        : word.replace(/^([^a-z]*)([a-z])/, (_, pre: string, c: string) => pre + c.toUpperCase()),
    )
    .join('');
}
