/**
 * Campaign finance (OpenFEC): a summary row per current member, refreshed in
 * rotation. Each member costs six requests, so a full pass over Congress takes a
 * few hours of the hourly budget; rows are refreshed about weekly, followed
 * members first. FEC data only changes when campaigns file (monthly or quarterly).
 */
import {
  BudgetExhaustedError,
  HttpError,
  fecTwoYearPeriod,
  isOrganisationEmployer,
  type FecByEmployer,
  type FecBySize,
  type FecByState,
  type FecCandidateTotals,
  type FecClient,
  type FecCommittee,
  type FecReceipt,
} from '@civic/congress-client';
import type { Sql } from '../db.ts';
import type { JobRun } from '../job.ts';

export const FINANCE_JOB = 'finance';
export const FEC_API = 'fec';
/** Refresh a member's row when it is older than this. */
export const FINANCE_MAX_AGE_DAYS = 7;

export interface FinanceCursor {
  [key: string]: unknown;
  lastMember?: string;
  refreshed?: number;
}

export interface FinanceRow {
  member_id: string;
  candidate_id: string;
  committee_id: string | null;
  committee_name: string | null;
  election_year: number;
  period: number;
  coverage_start: string | null;
  coverage_end: string | null;
  last_report: string | null;
  receipts: number | null;
  disbursements: number | null;
  cash_on_hand: number | null;
  debts: number | null;
  individual_small: number | null;
  individual_large: number | null;
  pacs: number | null;
  party: number | null;
  self_funding: number | null;
  transfers: number | null;
  by_size: { size: number; total: number; count: number | null }[];
  in_state: number | null;
  out_of_state: number | null;
  top_states: { state: string; total: number }[];
  top_employers: { name: string; total: number; count: number | null }[];
  top_committees: { name: string; id: string | null; total: number; type: string | null }[];
}

const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);
const money = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

/** Pure: turn the six FEC responses into one summary row. */
export function financeRow(input: {
  memberId: string;
  state: string | null;
  candidateId: string;
  electionYear: number;
  period: number;
  totals: FecCandidateTotals | null;
  committee: FecCommittee | null;
  employers: FecByEmployer[];
  sizes: FecBySize[];
  states: FecByState[];
  committees: FecReceipt[];
}): FinanceRow {
  const t = input.totals;
  const inState = input.states.filter((s) => s.state === input.state).reduce((n, s) => n + s.total, 0);
  const allStates = input.states.reduce((n, s) => n + s.total, 0);
  const employers = input.employers
    .filter((e) => isOrganisationEmployer(e.employer))
    .slice(0, 10)
    .map((e) => ({ name: e.employer!.trim(), total: money(e.total)!, count: e.count ?? null }));
  const byCommittee = new Map<string, { name: string; id: string | null; total: number; type: string | null }>();
  for (const r of input.committees) {
    // Line 11C is PAC money already; still skip any individual or candidate-committee rows.
    if (['IND', 'CAN', 'CCM'].includes(r.entity_type ?? '')) continue;
    const name = (r.contributor_name ?? '').trim();
    if (!name) continue;
    const key = r.contributor_id ?? name;
    const entry = byCommittee.get(key) ?? { name, id: r.contributor_id, total: 0, type: r.entity_type };
    entry.total += r.contribution_receipt_amount ?? 0;
    byCommittee.set(key, entry);
  }
  return {
    member_id: input.memberId,
    candidate_id: input.candidateId,
    committee_id: input.committee?.committee_id ?? null,
    committee_name: input.committee?.name ?? null,
    election_year: input.electionYear,
    period: input.period,
    coverage_start: day(t?.coverage_start_date),
    coverage_end: day(t?.coverage_end_date),
    last_report: t?.last_report_type_full ?? null,
    receipts: money(t?.receipts),
    disbursements: money(t?.disbursements),
    cash_on_hand: money(t?.last_cash_on_hand_end_period),
    debts: money(t?.last_debts_owed_by_committee),
    individual_small: money(t?.individual_unitemized_contributions),
    individual_large: money(t?.individual_itemized_contributions),
    pacs: money(t?.other_political_committee_contributions),
    party: money(t?.political_party_committee_contributions),
    self_funding: t ? money((t.candidate_contribution ?? 0) + (t.loans_made_by_candidate ?? 0)) : null,
    transfers: money(t?.transfers_from_other_authorized_committee),
    by_size: [...input.sizes]
      .sort((a, b) => a.size - b.size)
      .map((s) => ({ size: s.size, total: money(s.total)!, count: s.count ?? null })),
    in_state: input.states.length ? money(inState) : null,
    out_of_state: input.states.length ? money(allStates - inState) : null,
    top_states: [...input.states]
      .filter((s) => s.state)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((s) => ({ state: s.state!, total: money(s.total)! })),
    top_employers: employers,
    top_committees: [...byCommittee.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((c) => ({ ...c, total: money(c.total)! })),
  };
}

/** Fetch and build one member's row (six requests). Returns null if the FEC has nothing for the candidate. */
export async function fetchFinance(
  client: FecClient,
  member: { bioguide_id: string; state: string | null; fec_candidate_id: string; next_election: number },
  now = new Date(),
): Promise<FinanceRow | null> {
  const id = member.fec_candidate_id;
  const year = member.next_election;
  const period = fecTwoYearPeriod(now);
  const [totals, committee] = await Promise.all([client.candidateTotals(id, year), client.principalCommittee(id)]);
  if (!totals && !committee) return null;
  const [sizes, states, employers, committees] = await Promise.all([
    client.bySize(id, year),
    client.byState(id, year),
    committee ? client.byEmployer(committee.committee_id, period) : Promise.resolve([]),
    committee ? client.pacContributions(committee.committee_id, period) : Promise.resolve([]),
  ]);
  return financeRow({
    memberId: member.bioguide_id,
    state: member.state,
    candidateId: id,
    electionYear: year,
    period,
    totals,
    committee,
    employers,
    sizes,
    states,
    committees,
  });
}

/** Members due for a refresh: never fetched first, then followed members, then the oldest rows. */
async function dueMembers(sql: Sql, limit: number) {
  return sql<{ bioguide_id: string; state: string | null; fec_candidate_id: string; next_election: number }[]>`
    select m.bioguide_id, m.state, m.fec_candidate_id, m.next_election
      from public.members m
      left join public.member_finance f on f.member_id = m.bioguide_id
     where m.current and m.fec_candidate_id is not null and m.next_election is not null
       and (f.fetched_at is null or f.fetched_at < now() - make_interval(days => ${FINANCE_MAX_AGE_DAYS}))
     order by (f.fetched_at is null) desc,
              exists (select 1 from public.follows x where x.target_type = 'member' and x.target_id = m.bioguide_id) desc,
              f.fetched_at asc nulls first,
              m.bioguide_id
     limit ${limit}`;
}

export async function writeFinance(sql: Sql, row: FinanceRow): Promise<void> {
  const json = (v: unknown) => sql.json(v as never);
  await sql`
    insert into public.member_finance ${sql({
      ...row,
      by_size: json(row.by_size),
      top_states: json(row.top_states),
      top_employers: json(row.top_employers),
      top_committees: json(row.top_committees),
      fetched_at: new Date(),
      updated_at: new Date(),
    } as never)}
    on conflict (member_id) do update set
      candidate_id = excluded.candidate_id, committee_id = excluded.committee_id,
      committee_name = excluded.committee_name, election_year = excluded.election_year, period = excluded.period,
      coverage_start = excluded.coverage_start, coverage_end = excluded.coverage_end, last_report = excluded.last_report,
      receipts = excluded.receipts, disbursements = excluded.disbursements, cash_on_hand = excluded.cash_on_hand,
      debts = excluded.debts, individual_small = excluded.individual_small, individual_large = excluded.individual_large,
      pacs = excluded.pacs, party = excluded.party, self_funding = excluded.self_funding, transfers = excluded.transfers,
      by_size = excluded.by_size, in_state = excluded.in_state, out_of_state = excluded.out_of_state,
      top_states = excluded.top_states, top_employers = excluded.top_employers,
      top_committees = excluded.top_committees, fetched_at = excluded.fetched_at,
      updated_at = case when (member_finance.receipts, member_finance.coverage_end, member_finance.top_employers)
                              is distinct from (excluded.receipts, excluded.coverage_end, excluded.top_employers)
                        then excluded.updated_at else member_finance.updated_at end`;
}

/** One run: refresh as many due members as the budget and time allow. Resumable by design (state is in the rows). */
export async function syncFinance(
  run: JobRun<FinanceCursor>,
  options: { client: FecClient; batch?: number; now?: () => Date },
): Promise<FinanceCursor> {
  const { client } = options;
  const now = options.now ?? (() => new Date());
  const due = await dueMembers(run.sql, options.batch ?? 60);
  let refreshed = 0;
  let last: string | undefined;
  for (const member of due) {
    if (run.outOfTime() || client.budget.remaining < 6) break;
    try {
      const row = await fetchFinance(client, member, now());
      if (row) await writeFinance(run.sql, row);
      else {
        // Nothing on file: record an empty row so the member is not retried every hour.
        await writeFinance(run.sql, {
          ...financeRow({
            memberId: member.bioguide_id,
            state: member.state,
            candidateId: member.fec_candidate_id,
            electionYear: member.next_election,
            period: fecTwoYearPeriod(now()),
            totals: null,
            committee: null,
            employers: [],
            sizes: [],
            states: [],
            committees: [],
          }),
        });
      }
      run.rowsWritten += 1;
      refreshed += 1;
      last = member.bioguide_id;
    } catch (error) {
      if (error instanceof BudgetExhaustedError) break;
      if (error instanceof HttpError && error.status === 404) continue;
      throw error;
    }
  }
  run.log('finance', { due: due.length, refreshed });
  return { lastMember: last ?? run.cursor.lastMember, refreshed: (run.cursor.refreshed ?? 0) + refreshed };
}
