/**
 * Congressional committees:
 *  - committees, subcommittees and their members from congress-legislators
 *    (public domain, updated as assignments change), refreshed daily;
 *  - which committees each bill went to, read from the bill's own actions
 *    (each action names its committees), so it costs no extra requests for bills
 *    synced from now on; bills loaded earlier are caught up a batch at a time;
 *  - hearings and markups from Congress.gov's committee-meeting endpoints.
 */
import {
  BudgetExhaustedError,
  billId,
  committeeSystemCode,
  type BillAction,
  type CommitteeMeetingDetail,
  type CommitteeMembership,
  type CongressClient,
  type LegislatorCommittee,
  type LegislatorsClient,
} from '@civic/congress-client';
import { insertMany, upsertIfChanged, type AnySql, type Sql } from '../db.ts';
import type { JobRun } from '../job.ts';
import { catchUpBillTitles } from './bills.ts';
import { toDate, toTimestamp } from '../text.ts';

export const COMMITTEES_JOB = 'committees';
const ROSTER_MAX_AGE_MS = 20 * 3_600_000;
/** On the first run, meetings updated in the last 60 days (which includes everything upcoming). */
const MEETINGS_FIRST_WINDOW_MS = 60 * 86_400_000;

export interface CommitteesCursor {
  [key: string]: unknown;
  rostersAt?: string;
  /** Per chamber: start time of the last complete pass over the meeting list (ISO). */
  meetings?: Record<string, string>;
}

// ---- Committees and members ---------------------------------------------------

export interface CommitteeRow extends Record<string, unknown> {
  code: string;
  parent_code: string | null;
  chamber: 'house' | 'senate' | 'joint';
  name: string;
  url: string | null;
  jurisdiction: string | null;
  address: string | null;
  phone: string | null;
}

export interface CommitteeMemberRow extends Record<string, unknown> {
  committee_code: string;
  member_id: string;
  side: 'majority' | 'minority';
  rank: number;
  title: string | null;
}

export function committeeRows(committees: LegislatorCommittee[]): CommitteeRow[] {
  const rows: CommitteeRow[] = [];
  for (const c of committees) {
    const code = committeeSystemCode(c.thomas_id);
    rows.push({
      code,
      parent_code: null,
      chamber: c.type,
      name: c.name.trim(),
      url: c.url ?? null,
      jurisdiction: c.jurisdiction?.trim() || null,
      address: c.address ?? null,
      phone: c.phone ?? null,
    });
    for (const s of c.subcommittees ?? []) {
      rows.push({
        code: committeeSystemCode(c.thomas_id, s.thomas_id),
        parent_code: code,
        chamber: c.type,
        name: s.name.trim(),
        url: null,
        jurisdiction: null,
        address: s.address ?? null,
        phone: s.phone ?? null,
      });
    }
  }
  return rows;
}

/** Membership keys are "HSAG" (full committee) or "HSAG15" (subcommittee 15). */
export function committeeMemberRows(membership: CommitteeMembership): CommitteeMemberRow[] {
  const rows: CommitteeMemberRow[] = [];
  for (const [key, members] of Object.entries(membership)) {
    const m = /^([A-Z]{4})(\d{2})?$/.exec(key);
    if (!m) continue;
    const code = committeeSystemCode(m[1]!, m[2]);
    const seen = new Set<string>();
    for (const p of members) {
      if (!p.bioguide || seen.has(p.bioguide)) continue;
      seen.add(p.bioguide);
      rows.push({
        committee_code: code,
        member_id: p.bioguide,
        side: p.party === 'minority' ? 'minority' : 'majority',
        rank: p.rank,
        title: p.title?.trim() || null,
      });
    }
  }
  return rows;
}

export async function syncCommitteeRosters(sql: Sql, legislators: LegislatorsClient): Promise<number> {
  const [committees, membership] = await Promise.all([legislators.committees(), legislators.committeeMembership()]);
  const rows = committeeRows(committees);
  const members = committeeMemberRows(membership);
  // Guard against a truncated or broken upstream file wiping the rosters.
  const [stored] = await sql<{ n: number }[]>`select count(*)::int as n from public.committees where current`;
  if (rows.length === 0 || rows.length < stored!.n / 2) {
    throw new Error(`congress-legislators returned ${rows.length} committees (have ${stored!.n}); not replacing`);
  }
  let written = 0;
  await sql.begin(async (tx) => {
    for (const r of rows) if (await upsertIfChanged(tx, 'public.committees', ['code'], r)) written++;
    await tx`update public.committees set current = (code = any(${rows.map((r) => r.code)}::text[]))
              where current is distinct from (code = any(${rows.map((r) => r.code)}::text[]))`;
    // Membership is replaced as a set; it is small (a few thousand rows).
    const known = new Set(rows.map((r) => r.code));
    const keep = members.filter((m) => known.has(m.committee_code));
    const before = await tx<{ n: number }[]>`select count(*)::int as n from public.committee_members`;
    await tx`delete from public.committee_members`;
    await insertMany(tx, 'public.committee_members', keep);
    if (before[0]!.n !== keep.length) written += Math.abs(before[0]!.n - keep.length);
  });
  return written;
}

// ---- Bills in committee --------------------------------------------------------

export interface BillCommitteeRow extends Record<string, unknown> {
  bill_id: string;
  committee_code: string;
  committee_name: string | null;
  referred_date: string | null;
  reported_date: string | null;
  last_action_date: string | null;
  last_action_text: string | null;
}

const REPORTED = /\b(reported|ordered to be reported)\b/i;

/** One row per committee named in a bill's actions: first referral, first report, latest committee action. */
export function billCommitteeRows(id: string, actions: BillAction[]): BillCommitteeRow[] {
  const byCode = new Map<string, BillCommitteeRow>();
  // Oldest first, so the first date seen is the earliest.
  const ordered = [...actions].sort((a, b) => (a.actionDate ?? '').localeCompare(b.actionDate ?? ''));
  for (const a of ordered) {
    const date = toDate(a.actionDate);
    for (const c of a.committees ?? []) {
      if (!c.systemCode) continue;
      const code = c.systemCode.toLowerCase();
      const row =
        byCode.get(code) ??
        ({
          bill_id: id,
          committee_code: code,
          committee_name: c.name?.trim() || null,
          referred_date: date,
          reported_date: null,
          last_action_date: null,
          last_action_text: null,
        } as BillCommitteeRow);
      if (!row.reported_date && REPORTED.test(a.text ?? '') && !/discharged/i.test(a.text ?? ''))
        row.reported_date = date;
      row.last_action_date = date;
      row.last_action_text = (a.text ?? '').trim() || null;
      byCode.set(code, row);
    }
  }
  return [...byCode.values()];
}

/** Replace a bill's committee rows and mark it checked. */
export async function writeBillCommittees(tx: AnySql, id: string, actions: BillAction[]): Promise<number> {
  const rows = billCommitteeRows(id, actions);
  let written = 0;
  for (const r of rows)
    if (await upsertIfChanged(tx, 'public.bill_committees', ['bill_id', 'committee_code'], r)) written++;
  const removed = await tx`
    delete from public.bill_committees where bill_id = ${id}
       and committee_code <> all(${rows.map((r) => r.committee_code)}::text[]) returning 1`;
  await tx`update public.bills set committees_checked = true where id = ${id} and not committees_checked`;
  return written + removed.length;
}

/** Bills loaded before committee tracking: fetch their actions once, newest activity first. */
export async function catchUpBillCommittees(
  sql: Sql,
  client: CongressClient,
  limit: number,
  outOfTime: () => boolean,
): Promise<{ checked: number; written: number }> {
  const due = await sql<{ id: string; congress: number; bill_type: string; number: number }[]>`
    select id, congress, bill_type, number from public.bills
     where not committees_checked
     order by latest_action_date desc nulls last, id
     limit ${limit}`;
  let checked = 0;
  let written = 0;
  for (const b of due) {
    if (outOfTime() || client.budget.remaining < 2) break;
    const actions = await client.getBillActions(b.congress, b.bill_type, b.number);
    written += await sql.begin((tx) => writeBillCommittees(tx, b.id, actions));
    checked++;
  }
  return { checked, written };
}

// ---- Hearings and markups --------------------------------------------------------

export interface CommitteeMeetingRow extends Record<string, unknown> {
  id: string;
  congress: number;
  chamber: 'house' | 'senate' | 'joint';
  event_id: string;
  date: string | null;
  title: string | null;
  meeting_type: string | null;
  status: string | null;
  location: string | null;
  committee_codes: string[];
  committee_names: string[];
  witnesses: { name: string; organization: string | null; position: string | null }[];
  bill_ids: string[];
  video_url: string | null;
  url: string;
  source_updated_at: string | null;
}

/** congress.gov page for a meeting, e.g. /event/119th-Congress/house-event/119557. */
export function meetingPageUrl(congress: number, chamber: string, eventId: string): string {
  return `https://www.congress.gov/event/${congress}th-Congress/${chamber.toLowerCase()}-event/${eventId}`;
}

export function committeeMeetingRow(m: CommitteeMeetingDetail, fallbackChamber: string): CommitteeMeetingRow | null {
  if (!m.eventId || !m.congress) return null;
  const chamberText = (m.chamber ?? fallbackChamber).toLowerCase();
  const chamber = chamberText.startsWith('senate') ? 'senate' : chamberText.startsWith('house') ? 'house' : 'joint';
  const related = Array.isArray(m.relatedItems) ? m.relatedItems : m.relatedItems ? [m.relatedItems] : [];
  const bills = related.flatMap((r) => r.bills ?? []);
  const location = [m.location?.room, m.location?.building, m.location?.address].filter(Boolean).join(', ') || null;
  const videos = m.videos ?? [];
  return {
    id: `${m.congress}-${chamber}-${m.eventId}`,
    congress: m.congress,
    chamber,
    event_id: m.eventId,
    date: toTimestamp(m.date),
    title: m.title?.replace(/\s+/g, ' ').trim() || null,
    meeting_type: m.type ?? null,
    status: m.meetingStatus ?? null,
    location,
    committee_codes: (m.committees ?? []).map((c) => c.systemCode?.toLowerCase()).filter((c): c is string => !!c),
    committee_names: (m.committees ?? []).map((c) => c.name?.trim()).filter((c): c is string => !!c),
    witnesses: (m.witnesses ?? [])
      .filter((w) => w.name)
      .map((w) => ({
        name: w.name!.trim(),
        organization: w.organization?.trim() || null,
        position: w.position?.trim() || null,
      })),
    bill_ids: [
      ...new Set(
        bills
          .filter((b) => b.congress && b.type && b.number)
          .map((b) => billId(b.congress!, b.type!.toLowerCase(), b.number!)),
      ),
    ],
    video_url: (videos.find((v) => /youtube\.com|youtu\.be/.test(v.url ?? '')) ?? videos[0])?.url ?? null,
    url: meetingPageUrl(m.congress, chamber === 'joint' ? 'house' : chamber, m.eventId),
    source_updated_at: toTimestamp(m.updateDate),
  };
}

export async function syncCommitteeMeetings(
  sql: Sql,
  client: CongressClient,
  congress: number,
  chamber: 'house' | 'senate',
  since: string | undefined,
  outOfTime: () => boolean,
  now: Date,
): Promise<{ fetched: number; complete: boolean }> {
  const from = since ?? new Date(now.getTime() - MEETINGS_FIRST_WINDOW_MS).toISOString();
  const stored = new Map(
    (
      await sql<{ event_id: string; source_updated_at: string | null }[]>`
        select event_id, source_updated_at from public.committee_meetings where congress = ${congress} and chamber = ${chamber}`
    ).map((r) => [r.event_id, r.source_updated_at ? Date.parse(r.source_updated_at) : 0]),
  );
  let fetched = 0;
  for await (const item of client.listCommitteeMeetings(congress, chamber, { fromDateTime: from })) {
    if (!item.eventId) continue;
    const have = stored.get(item.eventId);
    if (have !== undefined && item.updateDate && Date.parse(item.updateDate) <= have) continue;
    if (outOfTime() || client.budget.remaining < 2) return { fetched, complete: false };
    const row = committeeMeetingRow(await client.getCommitteeMeeting(congress, chamber, item.eventId), chamber);
    if (row) await upsertIfChanged(sql, 'public.committee_meetings', ['id'], row);
    fetched++;
  }
  return { fetched, complete: true };
}

// ---- The job ------------------------------------------------------------------

export async function syncCommittees(
  run: JobRun<CommitteesCursor>,
  options: {
    legislators: LegislatorsClient;
    client: CongressClient;
    congress: number;
    catchUpBatch?: number;
    now?: Date;
  },
): Promise<CommitteesCursor> {
  const now = options.now ?? new Date();
  const cursor: CommitteesCursor = { ...run.cursor, meetings: { ...(run.cursor.meetings ?? {}) } };

  if (!cursor.rostersAt || now.getTime() - Date.parse(cursor.rostersAt) > ROSTER_MAX_AGE_MS) {
    run.rowsWritten += await syncCommitteeRosters(run.sql, options.legislators);
    cursor.rostersAt = now.toISOString();
    await run.checkpoint(cursor);
  }

  try {
    for (const chamber of ['house', 'senate'] as const) {
      const key = `${options.congress}-${chamber}`;
      const result = await syncCommitteeMeetings(
        run.sql,
        options.client,
        options.congress,
        chamber,
        cursor.meetings![key],
        run.outOfTime,
        now,
      );
      run.rowsWritten += result.fetched;
      // Advance only after a complete pass; an unfinished one is re-listed (and skipped item by item) next run.
      if (result.complete) cursor.meetings![key] = now.toISOString();
      run.log('committee meetings', { chamber, ...result });
    }
    const catchUp = await catchUpBillCommittees(run.sql, options.client, options.catchUpBatch ?? 60, run.outOfTime);
    run.rowsWritten += catchUp.written;
    run.log('bill committees catch-up', catchUp);
    // Same idea for short titles picked by an older rule (one titles request per bill).
    const titles = await catchUpBillTitles(run.sql, options.client, options.catchUpBatch ?? 60, run.outOfTime);
    run.rowsWritten += titles.changed;
    run.log('bill titles catch-up', titles);
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    run.log('committees: budget exhausted', {});
  }
  return cursor;
}
