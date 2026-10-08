/**
 * senate.gov roll-call vote XML. Senate votes are not in the Congress.gov API.
 * Senators are identified by LIS member ID; map them to Bioguide IDs with
 * congress-legislators (see legislators.ts).
 *
 * The XML is parsed defensively: every field is optional, whitespace is trimmed,
 * and per-member positions are validated against the file's own `<count>` block.
 */
import { XMLParser } from 'fast-xml-parser';
import { HttpClient, type HttpOptions } from './http.ts';
import { normalizePosition, type VotePosition } from './positions.ts';

export const SENATE_BASE = 'https://www.senate.gov/legislative/LIS';

export interface SenateMenuVote {
  rollNumber: number;
  /** As printed, e.g. `30-Sep`; the menu has no year, so use the vote XML for dates. */
  dateLabel: string;
  issue: string | null;
  question: string | null;
  result: string | null;
  yeas: number | null;
  nays: number | null;
  title: string | null;
}

export interface SenateMenu {
  congress: number;
  session: number;
  year: number | null;
  votes: SenateMenuVote[];
}

export interface SenateMemberVote {
  lisId: string;
  firstName: string | null;
  lastName: string | null;
  party: string | null;
  state: string | null;
  voteCast: string;
  position: VotePosition;
}

export interface SenateDocumentRef {
  congress: number | null;
  /** As printed, e.g. `H.R.`, `S.J.Res.`, `PN`. */
  type: string | null;
  number: string | null;
  name: string | null;
  title: string | null;
}

export interface SenateVote {
  congress: number;
  session: number;
  rollNumber: number;
  /** ISO 8601 with the Eastern offset in effect on that date. */
  date: string | null;
  modifyDate: string | null;
  question: string | null;
  questionText: string | null;
  title: string | null;
  result: string | null;
  resultText: string | null;
  majorityRequirement: string | null;
  document: SenateDocumentRef | null;
  amendmentNumber: string | null;
  /** Tallied from the member list. */
  totals: { yea: number; nay: number; present: number; notVoting: number };
  /** As stated in the file's <count> block (the official tally). */
  stated: { yea: number; nay: number; present: number; notVoting: number };
  members: SenateMemberVote[];
  /** True when the per-member tally equals the file's `<count>` block. */
  totalsMatchCount: boolean;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'vote' || name === 'member',
});

type Node = Record<string, unknown>;

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

function int(value: unknown): number | null {
  const s = text(value);
  if (s === null) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export function menuUrl(congress: number, session: number): string {
  return `${SENATE_BASE}/roll_call_lists/vote_menu_${congress}_${session}.xml`;
}

export function voteUrl(congress: number, session: number, rollNumber: number): string {
  return `${SENATE_BASE}/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${String(rollNumber).padStart(5, '0')}.xml`;
}

/** Human-facing page for a Senate roll call. */
export function voteHtmlUrl(congress: number, session: number, rollNumber: number): string {
  return `${SENATE_BASE}/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${String(rollNumber).padStart(5, '0')}.htm`;
}

export function parseSenateMenu(xml: string): SenateMenu {
  const root = (parser.parse(xml) as Node).vote_summary as Node | undefined;
  if (!root) throw new Error('Not a Senate vote menu');
  const votesNode = (root.votes as Node | undefined)?.vote as Node[] | undefined;
  const votes: SenateMenuVote[] = [];
  for (const vote of votesNode ?? []) {
    const roll = int(vote.vote_number);
    if (roll === null) continue;
    const tally = (vote.vote_tally as Node | undefined) ?? {};
    votes.push({
      rollNumber: roll,
      dateLabel: text(vote.vote_date) ?? '',
      issue: text(vote.issue),
      question: text(vote.question),
      result: text(vote.result),
      yeas: int(tally.yeas),
      nays: int(tally.nays),
      title: text(vote.title),
    });
  }
  return {
    congress: int(root.congress) ?? 0,
    session: int(root.session) ?? 0,
    year: int(root.congress_year),
    votes,
  };
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** US Eastern offset for a local wall-clock date: DST from 2nd Sunday of March to 1st Sunday of November. */
export function easternOffset(year: number, month: number, day: number): '-04:00' | '-05:00' {
  const nthSunday = (m: number, n: number) => {
    const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const dstStart = nthSunday(3, 2);
  const dstEnd = nthSunday(11, 1);
  const afterStart = month > 3 || (month === 3 && day >= dstStart);
  const beforeEnd = month < 11 || (month === 11 && day < dstEnd);
  return afterStart && beforeEnd ? '-04:00' : '-05:00';
}

/** Parse `September 30, 2026,  12:51 PM` (Eastern) to ISO 8601. */
export function parseSenateDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s*(?:(\d{1,2}):(\d{2})\s*([AP]M))?/i.exec(value.trim());
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (!month) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = m[4] ? Number(m[4]) : 12;
  const minute = m[5] ? Number(m[5]) : 0;
  if (m[6]) {
    const pm = m[6].toUpperCase() === 'PM';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${easternOffset(year, month, day)}`;
}

export function parseSenateVote(xml: string): SenateVote {
  const root = (parser.parse(xml) as Node).roll_call_vote as Node | undefined;
  if (!root) throw new Error('Not a Senate roll call vote');

  const members: SenateMemberVote[] = [];
  for (const m of ((root.members as Node | undefined)?.member as Node[] | undefined) ?? []) {
    const lisId = text(m.lis_member_id);
    const voteCast = text(m.vote_cast) ?? '';
    if (!lisId) continue;
    members.push({
      lisId,
      firstName: text(m.first_name),
      lastName: text(m.last_name),
      party: text(m.party),
      state: text(m.state),
      voteCast,
      position: normalizePosition(voteCast),
    });
  }

  const totals = { yea: 0, nay: 0, present: 0, notVoting: 0 };
  for (const m of members) {
    if (m.position === 'yea') totals.yea += 1;
    else if (m.position === 'nay') totals.nay += 1;
    else if (m.position === 'present') totals.present += 1;
    else totals.notVoting += 1;
  }

  const count = (root.count as Node | undefined) ?? {};
  const stated = {
    yea: int(count.yeas) ?? 0,
    nay: int(count.nays) ?? 0,
    present: int(count.present) ?? 0,
    notVoting: int(count.absent) ?? 0,
  };
  const totalsMatchCount =
    stated.yea === totals.yea &&
    stated.nay === totals.nay &&
    stated.present === totals.present &&
    stated.notVoting === totals.notVoting;

  const doc = (root.document as Node | undefined) ?? {};
  const amendment = (root.amendment as Node | undefined) ?? {};
  const document: SenateDocumentRef | null = text(doc.document_name)
    ? {
        congress: int(doc.document_congress),
        type: text(doc.document_type),
        number: text(doc.document_number),
        name: text(doc.document_name),
        title: text(doc.document_short_title) ?? text(doc.document_title),
      }
    : null;

  return {
    congress: int(root.congress) ?? 0,
    session: int(root.session) ?? 0,
    rollNumber: int(root.vote_number) ?? 0,
    date: parseSenateDate(text(root.vote_date)),
    modifyDate: parseSenateDate(text(root.modify_date)),
    question: text(root.question),
    questionText: text(root.vote_question_text),
    title: text(root.vote_title),
    result: text(root.vote_result),
    resultText: text(root.vote_result_text),
    majorityRequirement: text(root.majority_requirement),
    document,
    amendmentNumber: text(amendment.amendment_number),
    totals,
    stated,
    members,
    totalsMatchCount,
  };
}

/**
 * Map a Senate document type (`H.R.`, `S.J.Res.`, …) to a Congress.gov bill type
 * (`hr`, `sjres`, …). Returns null for nominations, treaties and anything else.
 */
export function senateDocTypeToBillType(type: string | null): string | null {
  if (!type) return null;
  const key = type.replace(/[.\s]/g, '').toLowerCase();
  const allowed = new Set(['hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres']);
  return allowed.has(key) ? key : null;
}

export class SenateClient {
  readonly http: HttpClient;

  constructor(options: HttpOptions = {}) {
    this.http = new HttpClient(options);
  }

  async getMenu(congress: number, session: number): Promise<SenateMenu> {
    return parseSenateMenu(await this.http.getText(menuUrl(congress, session), 'application/xml'));
  }

  async getVote(congress: number, session: number, rollNumber: number): Promise<SenateVote> {
    return parseSenateVote(await this.http.getText(voteUrl(congress, session, rollNumber), 'application/xml'));
  }
}
