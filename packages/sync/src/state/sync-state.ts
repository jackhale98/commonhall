/**
 * Nightly state sync from Open States: current-session bills (trimmed to
 * essentials) and, weekly, legislators, for all 50 states and DC.
 *
 * Open States' free-tier limits are low and unpublished, so the job:
 *  - spends at most a daily request budget (shared `api_usage`, per UTC day);
 *  - spaces requests out (the client's minIntervalMs);
 *  - works through states in priority order (states people follow first, then
 *    the least recently synced) and caps pages per state per run, so the first
 *    full load spreads over several nights and later nights are incremental.
 *
 * Bills are read oldest-update first with `updated_since` = the last updated_at
 * seen, always asking for page 1; this cannot skip bills the way page offsets
 * can when items change mid-run. New-bill feed events are only written once a
 * state's first full load is done.
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
import { upsertIfChanged, type Sql } from '../db.ts';
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

export interface StateBillsCursor {
  session: string;
  since?: string;
  page?: number;
  filled?: boolean;
  lastRun?: string;
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
  /** Pages of bills per state per run before moving on. Default 25. */
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
  let written = 0;
  await sql.begin(async (tx) => {
    for (const row of rows) {
      if (await upsertIfChanged(tx, 'public.state_bills', ['id'], row)) written += 1;
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

export async function syncStates(run: JobRun<StateCursor>, options: SyncStateOptions): Promise<StateCursor> {
  const { client } = options;
  const now = options.now ?? (() => new Date());
  const cursor: StateCursor = structuredClone(run.cursor ?? {});
  const pagesPerState = options.pagesPerState ?? 25;

  try {
    const checked = cursor.sessionsCheckedAt ? new Date(cursor.sessionsCheckedAt).getTime() : 0;
    if (now().getTime() - checked > WEEK_MS || !cursor.sessions) {
      run.rowsWritten += await refreshSessions(run.sql, client, cursor, now());
      await run.checkpoint(cursor);
    }

    for (const state of await stateOrder(run.sql, cursor, options.states)) {
      if (run.outOfTime() || client.budget.exhausted) break;
      const session = cursor.sessions?.[state];
      if (!session) continue;

      const legislatorsAt = cursor.legislatorsAt?.[state];
      if (!legislatorsAt || now().getTime() - new Date(legislatorsAt).getTime() > WEEK_MS) {
        run.rowsWritten += await syncLegislators(run.sql, client, state);
        cursor.legislatorsAt = { ...(cursor.legislatorsAt ?? {}), [state]: now().toISOString() };
        await run.checkpoint(cursor);
      }

      const bc: StateBillsCursor = { ...(cursor.bills?.[state] ?? { session }) };
      for (let pages = 0; pages < pagesPerState; pages++) {
        if (run.outOfTime()) break;
        const page = bc.page ?? 1;
        const result = await client.bills({
          jurisdiction: stateJurisdiction(state),
          session,
          updatedSince: bc.since,
          sort: 'updated_asc',
          page,
        });
        run.rowsWritten += await writeStateBills(run.sql, result.results, Boolean(bc.filled));
        const last = result.results.at(-1)?.updated_at;
        const done = result.results.length === 0 || page >= (result.pagination?.max_page ?? 1);
        if (done) {
          if (last) bc.since = last;
          bc.page = 1;
          bc.filled = true;
        } else if (last && last !== bc.since) {
          bc.since = last;
          bc.page = 1;
        } else {
          // A full page sharing one timestamp: step through pages at this timestamp.
          bc.page = page + 1;
        }
        bc.lastRun = now().toISOString();
        cursor.bills = { ...(cursor.bills ?? {}), [state]: bc };
        await run.checkpoint(cursor);
        if (done) break;
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
