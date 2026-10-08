/**
 * Build-time data, fetched once per build from Supabase (anon key, public read)
 * and shared by every page through module-level caches.
 *
 * With no Supabase configured (a fresh fork, CI on pull requests) everything is
 * empty and the build still succeeds.
 */
import { congressForDate } from '@civic/congress-client/ids';
import { select, selectAll } from './rest';
import { BILL_PAGE_COLUMNS, MEMBER_COLUMNS, type Bill, type BillAction, type Cosponsor, type Member } from './types';

export const CURRENT_CONGRESS = congressForDate(new Date());

/** Optional cap for quick local builds (e.g. SITE_MAX_BILL_PAGES=200). */
const MAX_BILL_PAGES = Number(process.env.SITE_MAX_BILL_PAGES ?? 0) || undefined;

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => (cached ??= fn());
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export const loadMembers = memo(async () => {
  const rows = await selectAll<Member>('members', { select: MEMBER_COLUMNS, order: 'bioguide_id.asc' });
  return new Map(rows.map((m) => [m.bioguide_id, m]));
});

export const loadBills = memo(async () => {
  const rows = await selectAll<Bill>('bills', {
    select: BILL_PAGE_COLUMNS,
    congress: `eq.${CURRENT_CONGRESS}`,
    order: 'latest_action_date.desc.nullslast,id.asc',
  });
  return MAX_BILL_PAGES ? rows.slice(0, MAX_BILL_PAGES) : rows;
});

const billPrefix = `like.${CURRENT_CONGRESS}-*`;

export const loadActions = memo(async () => {
  const rows = await selectAll<BillAction>('bill_actions', {
    select: 'bill_id,seq,action_date,text,chamber,source_system',
    bill_id: billPrefix,
    order: 'bill_id.asc,seq.asc',
  });
  return groupBy(rows, (r) => r.bill_id);
});

export const loadCosponsors = memo(async () => {
  const rows = await selectAll<Cosponsor>('bill_cosponsors', {
    select: 'bill_id,member_id,sponsored_date,withdrawn_date,is_original',
    bill_id: billPrefix,
    order: 'bill_id.asc,member_id.asc',
  });
  return groupBy(rows, (r) => r.bill_id);
});

export const loadSubjects = memo(async () => {
  const rows = await selectAll<{ bill_id: string; subject: string }>('bill_subjects', {
    select: 'bill_id,subject',
    bill_id: billPrefix,
    order: 'bill_id.asc,subject.asc',
  });
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.bill_id, [...(map.get(r.bill_id) ?? []), r.subject]);
  return map;
});

/** Bills each member sponsored this Congress, newest activity first. */
export const loadSponsored = memo(async () => {
  const bills = await loadBills();
  return groupBy(
    bills.filter((b) => b.sponsor_id),
    (b) => b.sponsor_id!,
  );
});

/** Policy areas in use, for the bills filter. */
export const loadPolicyAreas = memo(async () => {
  const bills = await loadBills();
  return [...new Set(bills.map((b) => b.policy_area).filter((p): p is string => Boolean(p)))].sort();
});

/** Active (not withdrawn) cosponsorships per member this Congress. */
export const loadCosponsorCounts = memo(async () => {
  const byBill = await loadCosponsors();
  const counts = new Map<string, number>();
  for (const rows of byBill.values()) {
    for (const r of rows) if (!r.withdrawn_date) counts.set(r.member_id, (counts.get(r.member_id) ?? 0) + 1);
  }
  return counts;
});

export interface VoteSummary {
  id: string;
  chamber: 'house' | 'senate';
  roll_number: number;
  date: string | null;
  question: string | null;
  result: string | null;
  bill_id: string | null;
  yea_total: number;
  nay_total: number;
  present_total: number;
  not_voting_total: number;
}

/** Every roll call this Congress, newest first. */
export const loadVotes = memo(async () =>
  selectAll<VoteSummary>('votes', {
    select: 'id,chamber,roll_number,date,question,result,bill_id,yea_total,nay_total,present_total,not_voting_total',
    congress: `eq.${CURRENT_CONGRESS}`,
    order: 'date.desc.nullslast,id.desc',
  }),
);

export const loadVotesByBill = memo(async () => {
  const votes = await loadVotes();
  return groupBy(
    votes.filter((v) => v.bill_id),
    (v) => v.bill_id!,
  );
});

export interface VoteStats {
  member_id: string;
  total_votes: number;
  votes_cast: number;
  missed: number;
  with_party: number;
  party_line_votes: number;
}

export const loadVoteStats = memo(async () => {
  const rows = await selectAll<VoteStats>('member_vote_stats', { congress: `eq.${CURRENT_CONGRESS}` });
  return new Map(rows.map((r) => [r.member_id, r]));
});

export interface StateLegislator {
  id: string;
  name: string;
  party: string | null;
  state: string;
  chamber: 'upper' | 'lower' | 'legislature' | null;
  district: string | null;
  title: string | null;
  photo_url: string | null;
  openstates_url: string | null;
}

export interface StateBill {
  id: string;
  state: string;
  session: string;
  identifier: string;
  title: string;
  chamber: string | null;
  latest_action_date: string | null;
  latest_action_text: string | null;
  primary_sponsor_id: string | null;
  primary_sponsor_name: string | null;
  openstates_url: string | null;
}

export const STATE_BILL_COLUMNS =
  'id,state,session,identifier,title,chamber,latest_action_date,latest_action_text,primary_sponsor_id,primary_sponsor_name,openstates_url';

export const loadStateLegislators = memo(async () => {
  const rows = await selectAll<StateLegislator>('state_legislators', {
    select: 'id,name,party,state,chamber,district,title,photo_url,openstates_url',
    current: 'eq.true',
    order: 'state.asc,chamber.asc,id.asc',
  });
  return groupBy(rows, (r) => r.state);
});

/** The 20 most recently active bills for a state (one request per state page). */
export async function loadRecentStateBills(state: string): Promise<{ bills: StateBill[] }> {
  const bills = await select<StateBill>('state_bills', {
    select: STATE_BILL_COLUMNS,
    state: `eq.${state}`,
    order: 'latest_action_date.desc.nullslast,id.asc',
    limit: 20,
  });
  return { bills };
}
