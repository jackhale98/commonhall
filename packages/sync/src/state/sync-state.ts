/**
 * Nightly state sync from Open States: current-session bills (trimmed to
 * essentials) and, weekly, legislators, for all 50 states and DC.
 *
 * Open States' free-tier limits are low (about 500 requests a day), so the job:
 *  - spends at most a daily request budget (shared `api_usage`, per UTC day);
 *  - spaces requests out (the client's minIntervalMs);
 *  - loads legislators for every state first (a few requests each), so every state
 *    page has its legislature before any bills;
 *  - then reads bills in rounds that alternate first-class states (Massachusetts)
 *    with each other state in turn, so first-class states get about half the
 *    requests and every state moves forward every night.
 *
 * A state's first load reads newest-updated bills first (page by page), so its
 * recent bills appear after one request; it remembers the newest timestamp seen at
 * the start. When the load reaches the end (or bills an earlier load already
 * stored), the state switches to the nightly catch-up: oldest-update first with
 * `updated_since`, always page 1, which cannot skip bills the way page offsets can.
 * Anything updated during the first load is newer than that starting timestamp, so
 * the catch-up gets it. New-bill feed events are only written once a state's first
 * full load is done.
 */
import {
  BudgetExhaustedError,
  HttpError,
  RequestBudget,
  currentSession,
  jurisdictionToState,
  stateJurisdiction,
  type OSBill,
  type OSPerson,
  type OpenStatesClient,
} from '@civic/congress-client';
import { upsertIfChanged, type AnySql, type Sql } from '../db.ts';
import { toDate } from '../text.ts';
import { hash, writeFeedEvents, type FeedEventRow } from '../federal/events.ts';
import type { JobRun } from '../job.ts';

export const STATE_JOB = 'state';
export const OPENSTATES_API = 'openstates';

/** 50 states and DC: the legislatures Open States covers. */
export const STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

const WEEK_MS = 7 * 24 * 3_600_000;
/** How often a loaded state (other than a first-class one) is checked for changes. */
const CATCH_UP_EVERY_MS = 20 * 3_600_000;

export interface StateBillsCursor {
  session: string;
  /** Catch-up: bills updated since this time (oldest first). */
  since?: string;
  page?: number;
  filled?: boolean;
  lastRun?: string;
  /** First load (newest first): the newest updated_at when it began, and the next page. */
  newest?: string;
  backPage?: number;
  /** First load can stop at bills updated before this: an earlier load stored them. */
  stopAt?: string;
}

export interface StateCursor extends Record<string, unknown> {
  sessions?: Record<string, string>;
  sessionsCheckedAt?: string;
  bills?: Record<string, StateBillsCursor>;
  legislatorsAt?: Record<string, string>;
}

export interface SyncStateOptions {
  client: OpenStatesClient;
  now?: () => Date;
  /** At most this many pages of bills per state per run. Default 60. */
  pagesPerState?: number;
  /** Only these states (e.g. for a manual run). */
  states?: string[];
}

/** Budget for today: min(per-run cap, daily cap minus what was used today). */
export async function dailyBudget(sql: Sql, api: string, dailyCap: number, runCap: number): Promise<RequestBudget> {
  const [row] = await sql<{ used: number }[]>`
    select public.api_usage_since(${api}, date_trunc('day', now())) as used`;
  return new RequestBudget(Math.max(0, Math.min(runCap, dailyCap - (row?.used ?? 0))), api);
}

export function stateBillRow(bill: OSBill): Record<string, unknown> | null {
  const state = jurisdictionToState(bill.jurisdiction?.id ?? '');
  if (!state) return null;
  const sponsor = bill.sponsorships?.find((s) => s.primary) ?? bill.sponsorships?.[0];
  const chamber = bill.from_organization?.classification;
  return {
    id: bill.id,
    state,
    session: bill.session,
    identifier: bill.identifier,
    title: bill.title?.trim() || bill.identifier,
    chamber: chamber === 'upper' || chamber === 'lower' || chamber === 'legislature' ? chamber : null,
    classification: bill.classification?.[0] ?? null,
    first_action_date: toDate(bill.first_action_date),
    latest_action_date: toDate(bill.latest_action_date),
    latest_action_text: bill.latest_action_description?.trim() || null,
    latest_passage_date: toDate(bill.latest_passage_date),
    primary_sponsor_id: sponsor?.person?.id ?? null,
    primary_sponsor_name: sponsor?.person?.name ?? sponsor?.name ?? null,
    openstates_url: bill.openstates_url ?? null,
    updated_at: bill.updated_at ?? null,
  };
}

/** Every sponsor of a bill, primary first, in Open States' order. */
export function stateBillSponsorRows(bill: OSBill): Record<string, unknown>[] {
  const list = [...(bill.sponsorships ?? [])].filter((s) => s.person?.name ?? s.name);
  list.sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
  return list.map((s, i) => ({
    bill_id: bill.id,
    seq: i,
    person_id: s.person?.id ?? null,
    name: (s.person?.name ?? s.name).trim(),
    is_primary: Boolean(s.primary),
    classification: s.classification ?? null,
  }));
}

/** Replace a bill's sponsors when the list has changed; returns rows written. */
async function writeSponsors(tx: AnySql, billId: string, rows: Record<string, unknown>[]): Promise<number> {
  const key = (r: Record<string, unknown>) => `${r.person_id ?? ''}|${r.name}|${r.is_primary}`;
  const existing = await tx<Record<string, unknown>[]>`
    select person_id, name, is_primary from public.state_bill_sponsors where bill_id = ${billId} order by seq`;
  if (existing.map(key).join('\n') === rows.map(key).join('\n')) return 0;
  await tx`delete from public.state_bill_sponsors where bill_id = ${billId}`;
  if (rows.length) await tx`insert into public.state_bill_sponsors ${tx(rows as never)}`;
  return rows.length;
}

export function stateLegislatorRow(person: OSPerson): Record<string, unknown> | null {
  const state = jurisdictionToState(person.jurisdiction?.id ?? '');
  if (!state) return null;
  const role = person.current_role;
  const chamber = role?.org_classification;
  return {
    id: person.id,
    name: person.name,
    party: person.party ?? null,
    state,
    chamber: chamber === 'upper' || chamber === 'lower' || chamber === 'legislature' ? chamber : null,
    district: role?.district !== undefined && role?.district !== null ? String(role.district) : null,
    title: role?.title ?? null,
    photo_url: person.image || null,
    email: person.email || null,
    openstates_url: person.openstates_url ?? null,
    current: true,
    updated_at: person.updated_at ?? null,
  };
}

function stateBillEvents(
  row: Record<string, unknown>,
  previous: { latest_action_date: string | null; latest_action_text: string | null } | undefined,
  filled: boolean,
): FeedEventRow[] {
  const label = `${row.state} ${row.identifier}`;
  const payload = { label, title: row.title, openstates_url: row.openstates_url, state: row.state };
  const events: FeedEventRow[] = [];
  if (!previous && filled) {
    events.push({
      target_type: 'state_bill',
      target_id: row.id as string,
      kind: 'new_bill',
      member_type: row.primary_sponsor_id ? 'state_legislator' : null,
      member_id: (row.primary_sponsor_id as string | null) ?? null,
      occurred_at: row.first_action_date ? `${row.first_action_date}T12:00:00.000Z` : new Date().toISOString(),
      summary: `${label} introduced: ${row.title}`,
      payload,
      dedupe_key: `state_new:${row.id}`,
    });
  }
  const changed =
    previous &&
    row.latest_action_text &&
    (previous.latest_action_text !== row.latest_action_text || previous.latest_action_date !== row.latest_action_date);
  if (changed) {
    events.push({
      target_type: 'state_bill',
      target_id: row.id as string,
      kind: 'action',
      member_type: null,
      member_id: null,
      occurred_at: row.latest_action_date ? `${row.latest_action_date}T12:00:00.000Z` : new Date().toISOString(),
      summary: `${label}: ${row.latest_action_text}`,
      payload: { ...payload, text: row.latest_action_text, action_date: row.latest_action_date },
      dedupe_key: `state_action:${row.id}:${row.latest_action_date ?? ''}:${hash(String(row.latest_action_text))}`,
    });
  }
  return events;
}

async function writeStateBills(sql: Sql, bills: OSBill[], filled: boolean): Promise<number> {
  const rows = bills.map(stateBillRow).filter((r): r is Record<string, unknown> => r !== null);
  if (rows.length === 0) return 0;
  const previous = new Map(
    (
      await sql<{ id: string; latest_action_date: string | null; latest_action_text: string | null }[]>`
        select id, to_char(latest_action_date, 'YYYY-MM-DD') as latest_action_date, latest_action_text
          from public.state_bills where id = any(${rows.map((r) => r.id as string)}::text[])`
    ).map((r) => [r.id, r]),
  );
  const byId = new Map(bills.map((b) => [b.id, b]));
  let written = 0;
  await sql.begin(async (tx) => {
    for (const row of rows) {
      if (await upsertIfChanged(tx, 'public.state_bills', ['id'], row)) written += 1;
      const bill = byId.get(row.id as string);
      if (bill?.sponsorships) written += await writeSponsors(tx, bill.id, stateBillSponsorRows(bill));
      written += await writeFeedEvents(tx, stateBillEvents(row, previous.get(row.id as string), filled));
    }
  });
  return written;
}

async function syncLegislators(sql: Sql, client: OpenStatesClient, state: string): Promise<number> {
  const people: OSPerson[] = [];
  for (let page = 1; ; page++) {
    const result = await client.people(stateJurisdiction(state), page);
    people.push(...result.results);
    if (page >= (result.pagination?.max_page ?? 1)) break;
  }
  const rows = people.map(stateLegislatorRow).filter((r): r is Record<string, unknown> => r !== null);
  let written = 0;
  await sql.begin(async (tx) => {
    for (const row of rows) if (await upsertIfChanged(tx, 'public.state_legislators', ['id'], row)) written += 1;
    const retired = await tx`
      update public.state_legislators set current = false
       where state = ${state} and current and id <> all(${rows.map((r) => r.id as string)}::text[])
       returning 1`;
    written += retired.length;
  });
  return written;
}

/** First-class states: synced first every night and given prerendered bill pages (see docs/decisions.md). */
export const FIRST_CLASS_STATES = ['MA'];

/** First-class states, then states people follow or saved in their profile, then least recently synced. */
async function stateOrder(sql: Sql, cursor: StateCursor, only?: string[]): Promise<string[]> {
  const wanted = await sql<{ state: string; n: number }[]>`
    select state, count(*)::int as n from (
      select b.state from public.follows f join public.state_bills b on f.target_type = 'state_bill' and b.id = f.target_id
      union all
      select l.state from public.follows f join public.state_legislators l on f.target_type = 'state_legislator' and l.id = f.target_id
      union all
      select state from public.profiles where state is not null
    ) s group by state`;
  const demand = new Map(wanted.map((w) => [w.state, w.n]));
  const pool = only ?? STATES;
  return [...pool].sort((a, b) => {
    const first = Number(FIRST_CLASS_STATES.includes(b)) - Number(FIRST_CLASS_STATES.includes(a));
    if (first !== 0) return first;
    const unfilledA = cursor.bills?.[a]?.filled ? 1 : 0;
    const unfilledB = cursor.bills?.[b]?.filled ? 1 : 0;
    const d = (demand.get(b) ?? 0) - (demand.get(a) ?? 0);
    if (d !== 0) return d;
    const lastA = cursor.bills?.[a]?.lastRun ?? '';
    const lastB = cursor.bills?.[b]?.lastRun ?? '';
    if (lastA !== lastB) return lastA.localeCompare(lastB);
    return unfilledA - unfilledB;
  });
}

async function refreshSessions(sql: Sql, client: OpenStatesClient, cursor: StateCursor, now: Date): Promise<number> {
  const result = await client.jurisdictions();
  let written = 0;
  const sessions = { ...(cursor.sessions ?? {}) };
  const bills = { ...(cursor.bills ?? {}) };
  for (const j of result.results) {
    const state = jurisdictionToState(j.id);
    if (!state || !STATES.includes(state)) continue;
    const session = currentSession(j.legislative_sessions ?? [], now);
    if (!session) continue;
    if (sessions[state] && sessions[state] !== session.identifier) {
      // A new session: start over for this state and drop the old session's bills.
      const removed =
        await sql`delete from public.state_bills where state = ${state} and session <> ${session.identifier} returning 1`;
      written += removed.length;
      bills[state] = { session: session.identifier };
    }
    sessions[state] = session.identifier;
    bills[state] ??= { session: session.identifier };
  }
  cursor.sessions = sessions;
  cursor.bills = bills;
  cursor.sessionsCheckedAt = now.toISOString();
  return written;
}

/**
 * One page of a state's bills: newest first during its first load, then the nightly
 * catch-up (oldest update first since the last one seen). Returns true when the state
 * has nothing more to read this run.
 */
async function billPage(
  run: JobRun<StateCursor>,
  client: OpenStatesClient,
  cursor: StateCursor,
  state: string,
  now: Date,
): Promise<boolean> {
  const session = cursor.sessions![state]!;
  const bc: StateBillsCursor = { ...(cursor.bills?.[state] ?? { session }) };
  let done: boolean;
  if (!bc.filled) {
    // First load, newest first. A state part-loaded by the older oldest-first load keeps
    // those bills: this load stops when it reaches them.
    if (bc.backPage === undefined) {
      bc.stopAt = bc.since;
      bc.backPage = 1;
      bc.page = 1;
    }
    const page = bc.backPage;
    const result = await client.bills({
      jurisdiction: stateJurisdiction(state),
      session,
      sort: 'updated_desc',
      page,
    });
    if (page === 1) bc.newest = result.results[0]?.updated_at ?? bc.newest;
    run.rowsWritten += await writeStateBills(run.sql, result.results, false);
    const oldest = result.results.at(-1)?.updated_at;
    done =
      result.results.length === 0 ||
      page >= (result.pagination?.max_page ?? 1) ||
      Boolean(bc.stopAt && oldest && oldest < bc.stopAt);
    if (done) {
      // Loaded: from now on, catch up from the newest bill seen when the load began.
      bc.filled = true;
      bc.since = bc.newest ?? bc.since;
      bc.page = 1;
      delete bc.backPage;
      delete bc.stopAt;
      delete bc.newest;
    } else bc.backPage = page + 1;
  } else {
    const page = bc.page ?? 1;
    const result = await client.bills({
      jurisdiction: stateJurisdiction(state),
      session,
      updatedSince: bc.since,
      sort: 'updated_asc',
      page,
    });
    run.rowsWritten += await writeStateBills(run.sql, result.results, true);
    const last = result.results.at(-1)?.updated_at;
    done = result.results.length === 0 || page >= (result.pagination?.max_page ?? 1);
    if (done) {
      if (last) bc.since = last;
      bc.page = 1;
    } else if (last && last !== bc.since) {
      bc.since = last;
      bc.page = 1;
    } else {
      // A full page sharing one timestamp: step through pages at this timestamp.
      bc.page = page + 1;
    }
  }
  bc.lastRun = now.toISOString();
  cursor.bills = { ...(cursor.bills ?? {}), [state]: bc };
  await run.checkpoint(cursor);
  return done;
}

export async function syncStates(run: JobRun<StateCursor>, options: SyncStateOptions): Promise<StateCursor> {
  const { client } = options;
  const now = options.now ?? (() => new Date());
  const cursor: StateCursor = structuredClone(run.cursor ?? {});
  const pagesPerState = options.pagesPerState ?? 60;

  try {
    const checked = cursor.sessionsCheckedAt ? new Date(cursor.sessionsCheckedAt).getTime() : 0;
    if (now().getTime() - checked > WEEK_MS || !cursor.sessions) {
      run.rowsWritten += await refreshSessions(run.sql, client, cursor, now());
      await run.checkpoint(cursor);
    }
    const order = (await stateOrder(run.sql, cursor, options.states)).filter((state) => cursor.sessions?.[state]);

    // 1. Legislators for every state that is due (weekly), before any bills.
    for (const state of order) {
      if (run.outOfTime() || client.budget.exhausted) return cursor;
      const legislatorsAt = cursor.legislatorsAt?.[state];
      if (legislatorsAt && now().getTime() - new Date(legislatorsAt).getTime() <= WEEK_MS) continue;
      run.rowsWritten += await syncLegislators(run.sql, client, state);
      cursor.legislatorsAt = { ...(cursor.legislatorsAt ?? {}), [state]: now().toISOString() };
      await run.checkpoint(cursor);
    }

    // 2. Bills in rounds: first-class states alternate with each other state in turn.
    const pages = new Map<string, number>();
    // Loaded states catch up once a day (first-class states every run), so the checks
    // don't use up the budget that first loads need.
    const caughtUp = new Set(
      order.filter((st) => {
        const bc = cursor.bills?.[st];
        return (
          bc?.filled &&
          !FIRST_CLASS_STATES.includes(st) &&
          bc.lastRun &&
          now().getTime() - new Date(bc.lastRun).getTime() < CATCH_UP_EVERY_MS
        );
      }),
    );
    const busy = (state: string) => !caughtUp.has(state) && (pages.get(state) ?? 0) < pagesPerState;
    for (;;) {
      const first = order.filter((st) => FIRST_CLASS_STATES.includes(st) && busy(st));
      const others = order.filter((st) => !FIRST_CLASS_STATES.includes(st) && busy(st));
      if (first.length === 0 && others.length === 0) break;
      const round = others.length ? others.flatMap((st) => [...first, st]) : first;
      for (const state of round) {
        if (!busy(state)) continue;
        if (run.outOfTime() || client.budget.exhausted) return cursor;
        const done = await billPage(run, client, cursor, state, now());
        pages.set(state, (pages.get(state) ?? 0) + 1);
        if (done) caughtUp.add(state);
      }
    }
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      run.log('Open States budget used up; will continue next run');
      return cursor;
    }
    if (error instanceof HttpError && error.status === 401) {
      throw new Error('Open States rejected the API key (401).', { cause: error });
    }
    throw error;
  }
  return cursor;
}
