/**
 * Somerville, Massachusetts: its City Council on Legistar (the shared Legistar sync with
 * Somerville's settings) and 311 request summaries from the city's Socrata portal.
 *
 * Council (every 15 minutes, `syncLegistarCity` with SOMERVILLE): eleven councilors,
 * one per ward (7) and four at large. Legistar names the seat in each office record's
 * title ("Ward Three City Councilor", "City Councilor At Large"), so there is no seat
 * map to keep. Committees are Legistar bodies of their own ("Finance Committee"), so
 * their meetings are read by body rather than from location text as in Boston.
 *
 * 311 (daily): data.somervillema.gov "311 Service, Information, and Feedback Requests"
 * (4pyi-uqq6). One SoQL query per run asks the portal for counts per day, ward and
 * request type over the last REPORT_311_DAYS days, service requests only (information
 * calls and feedback are not requests for work). The dataset has no closed date: a
 * request whose most recent status is "Closed" closed at that status's date, so the
 * portal also returns, per group, how many have closed and the median hours to close.
 * Dates are text in Somerville time ("2026-10-09 23:53:00"). The city sets no target
 * times, so there is no "on time" count (the report says so). Only the finished report
 * is stored (report-311.ts); no request is.
 */
import { REPORT_311_DAYS, checkKept, report311, type Day311, type SocrataClient } from '@civic/congress-client';
import type { JobRun } from '../job.ts';
import { addDays, bostonToday, storeReport311 } from './boston-311.ts';
import type { LegistarCity } from './boston.ts';

export const SOMERVILLE_JOB = 'somerville';
export const SOMERVILLE_311_JOB = 'somerville-311';
export const SOMERVILLE_CITY = 'ma-somerville';
export const SOMERVILLE_PORTAL = 'data.somervillema.gov';
export const SOMERVILLE_311_DATASET = '4pyi-uqq6';
/** Somerville's seven wards. */
export const SOMERVILLE_WARDS = 7;

/**
 * Council legislation: orders and resolutions (councilors'), ordinances, home rule
 * petitions and the mayor's requests (appropriations, grants, appointments, loan
 * orders), which the council votes on. Not loaded: licenses, grants of location and
 * small wireless facilities (permits the council grants, about 400 a year), and
 * communications, minutes, committee reports, citations and remembrances.
 */
export const SOMERVILLE_LEGISLATIVE_TYPES = new Set([
  'Order',
  'Resolution',
  'Ordinance',
  'Zoning Ordinance',
  "Mayor's Request",
  'Home Rule Petition',
]);

/** Standing committees that meet, by Legistar body name → the name the site shows ("Finance"). */
export const SOMERVILLE_COMMITTEE_BODIES: Readonly<Record<string, string>> = Object.fromEntries(
  [
    'Confirmation of Appointments and Personnel Matters Committee',
    'Finance Committee',
    'Housing, Community Development and Equity Committee',
    'Land Use Committee',
    'Legislative Matters Committee',
    'Licenses and Permits Committee',
    'Public Health and Public Safety Committee',
    'School Building Facilities and Maintenance Committee',
    'Sustainability and Infrastructure Committee',
    'Traffic and Parking Committee',
  ].map((body) => [body, body.replace(/\s+Committee$/, '')]),
);

const NUMBER_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

/**
 * A seat from an office record title: "Ward Three City Councilor" → Ward 3, "City
 * Councilor At Large" → At-Large. `word` is what the city calls a district. Null when
 * the title names neither.
 */
export function seatFromTitle(title: string | null, word = 'Ward'): { seat: string; district: number | null } | null {
  const text = (title ?? '').toLowerCase();
  if (/\bat[\s-]*large\b/.test(text)) return { seat: 'At-Large', district: null };
  const m = new RegExp(`\\b${word.toLowerCase()}\\s+(\\d+|[a-z]+)\\b`).exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : NUMBER_WORDS.indexOf(m[1]!) + 1;
  return n >= 1 ? { seat: `${word} ${n}`, district: n } : null;
}

export const SOMERVILLE: LegistarCity = {
  key: SOMERVILLE_CITY,
  name: 'Somerville',
  legistar: 'somervillema',
  councilBody: 'City Council',
  legislativeTypes: SOMERVILLE_LEGISLATIVE_TYPES,
  committees: Object.values(SOMERVILLE_COMMITTEE_BODIES),
  committeeBodies: SOMERVILLE_COMMITTEE_BODIES,
  // Somerville files are "25-0019".
  docketLabel: (file) => `File #${file}`,
  seatFromTitle: (title) => seatFromTitle(title, 'Ward'),
};

/** The fields the 311 query returns (column aliases; Socrata leaves out nulls). */
export const SOMERVILLE_311_SHAPE = {
  day: 'date',
  ward: 'string?',
  type: 'string',
  opened: 'string',
  closed: 'string',
  median_close_hours: 'string?',
};

const CREATED = 'date_created::floating_timestamp';
const STATUS = 'most_recent_status_date::floating_timestamp';
/**
 * Hours from creation to the latest status. SoQL has date_diff_d (whole days) but no
 * hours, so: whole days × 24 plus the minutes past them, from the clock times.
 */
const HOURS = `(date_diff_d(${STATUS}, ${CREATED}) * 24 + ((date_extract_hh(${STATUS}) * 60 + date_extract_mm(${STATUS}) - date_extract_hh(${CREATED}) * 60 - date_extract_mm(${CREATED}) + 1440) % 1440) / 60)`;

/** SoQL for service requests created on the days [from, to]: counts per day, ward and type. */
export function somerville311Query(from: string, to: string) {
  return {
    $select: [
      `date_trunc_ymd(${CREATED}) AS day`,
      'ward',
      'type',
      'count(*) AS opened',
      "sum(case(most_recent_status = 'Closed', 1, true, 0)) AS closed",
      `median(case(most_recent_status = 'Closed', ${HOURS})) AS median_close_hours`,
    ].join(', '),
    // Text dates in "YYYY-MM-DD hh:mm:ss" compare in order.
    $where: `classification = 'Service' AND date_created >= '${from}' AND date_created < '${addDays(to, 1)}'`,
    $group: 'day, ward, type',
    $order: 'day, ward, type',
  };
}

/** A summary row from the portal; null without a day or type. Wards outside 1–7 become 0. */
export function somervilleRow311(r: Record<string, unknown>): Day311 | null {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(String(r.day ?? ''))?.[0];
  const type = String(r.type ?? '').trim();
  if (!day || !type) return null;
  const ward = Number(String(r.ward ?? '').trim());
  const median =
    r.median_close_hours === undefined || r.median_close_hours === null ? NaN : Number(r.median_close_hours);
  return {
    day,
    district: Number.isInteger(ward) && ward >= 1 && ward <= SOMERVILLE_WARDS ? ward : 0,
    request_type: type,
    source: 'somerville',
    opened: Number(r.opened) || 0,
    closed: Number(r.closed) || 0,
    closed_on_time: 0,
    median_close_hours: Number.isFinite(median) ? Math.round(median * 100) / 100 : null,
  };
}

export async function syncSomerville311(
  run: JobRun<Record<string, unknown>>,
  options: { client: SocrataClient; now?: () => Date },
): Promise<Record<string, unknown>> {
  const today = bostonToday(options.now?.() ?? new Date());
  const to = addDays(today, -1);
  const from = addDays(today, -REPORT_311_DAYS);
  const raw = await options.client.all<Record<string, unknown>>(
    SOMERVILLE_311_DATASET,
    somerville311Query(from, to),
    SOMERVILLE_311_SHAPE,
  );
  const rows = raw.map(somervilleRow311).filter((r): r is Day311 => r !== null);
  checkKept(`Socrata ${SOMERVILLE_PORTAL} ${SOMERVILLE_311_DATASET}`, raw.length, rows.length);
  const report = report311(rows, { districts: SOMERVILLE_WARDS, onTime: false });
  if (!report || report.city.opened === 0) throw new Error('Somerville 311: no requests came back for the last month');
  run.rowsWritten += await storeReport311(run.sql, SOMERVILLE_CITY, report);
  run.log('somerville-311', {
    groups: raw.length,
    from: report.from,
    to: report.to,
    opened: report.city.opened,
    closed: report.city.closed,
    changed: run.rowsWritten,
  });
  return {};
}
