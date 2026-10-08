/**
 * Bill identity is `{congress}-{billType lowercased}-{number}`, e.g. `119-hr-1234`.
 * Vote identity is `{chamber}-{congress}-{session}-{rollNumber}`.
 */

export const BILL_TYPES = ['hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres'] as const;
export type BillType = (typeof BILL_TYPES)[number];

export interface BillRef {
  congress: number;
  type: BillType;
  number: number;
}

export function isBillType(value: string): value is BillType {
  return (BILL_TYPES as readonly string[]).includes(value);
}

export function billId(congress: number | string, type: string, number: number | string): string {
  return `${Number(congress)}-${String(type).toLowerCase()}-${Number(number)}`;
}

export function parseBillId(id: string): BillRef | null {
  const m = /^(\d{1,3})-([a-z]+)-(\d{1,6})$/.exec(id.trim().toLowerCase());
  if (!m) return null;
  const type = m[2]!;
  if (!isBillType(type)) return null;
  return { congress: Number(m[1]), type, number: Number(m[3]) };
}

const DISPLAY: Record<BillType, string> = {
  hr: 'H.R.',
  s: 'S.',
  hjres: 'H.J.Res.',
  sjres: 'S.J.Res.',
  hconres: 'H.Con.Res.',
  sconres: 'S.Con.Res.',
  hres: 'H.Res.',
  sres: 'S.Res.',
};

/** `H.R. 1234` */
export function billLabel(type: string, number: number | string): string {
  const t = type.toLowerCase();
  return `${isBillType(t) ? DISPLAY[t] : type.toUpperCase()} ${number}`;
}

const CONGRESS_GOV_SLUG: Record<BillType, string> = {
  hr: 'house-bill',
  s: 'senate-bill',
  hjres: 'house-joint-resolution',
  sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution',
  sconres: 'senate-concurrent-resolution',
  hres: 'house-resolution',
  sres: 'senate-resolution',
};

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export function congressGovBillUrl(congress: number, type: string, number: number | string): string {
  const t = type.toLowerCase() as BillType;
  return `https://www.congress.gov/bill/${ordinal(congress)}-congress/${CONGRESS_GOV_SLUG[t] ?? t}/${number}`;
}

export function chamberForBillType(type: string): 'house' | 'senate' {
  return type.toLowerCase().startsWith('h') ? 'house' : 'senate';
}

export type Chamber = 'house' | 'senate';

export function voteId(chamber: Chamber, congress: number, session: number, rollNumber: number): string {
  return `${chamber}-${congress}-${session}-${rollNumber}`;
}

export function parseVoteId(
  id: string,
): { chamber: Chamber; congress: number; session: number; rollNumber: number } | null {
  const m = /^(house|senate)-(\d+)-(\d)-(\d+)$/.exec(id.trim());
  if (!m) return null;
  return { chamber: m[1] as Chamber, congress: Number(m[2]), session: Number(m[3]), rollNumber: Number(m[4]) };
}

/** First year of a Congress: the 119th began in 2025. */
export function congressStartYear(congress: number): number {
  return 1789 + (congress - 1) * 2;
}

/** The Congress in session for a date (new Congresses start on 3 January of odd years). */
export function congressForDate(date: Date): number {
  const year = date.getUTCFullYear();
  const beforeJan3 = date.getUTCMonth() === 0 && date.getUTCDate() < 3;
  const effectiveYear = beforeJan3 ? year - 1 : year;
  return Math.floor((effectiveYear - 1789) / 2) + 1;
}
