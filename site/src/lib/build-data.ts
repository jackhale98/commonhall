/**
 * Build-time data, fetched once per build from Supabase (anon key, public read)
 * and shared by every page through module-level caches.
 *
 * With no Supabase configured (a fresh fork, CI on pull requests) everything is
 * empty and the build still succeeds.
 */
import { congressForDate } from '@civic/congress-client/ids';
import demoData from '../data/demo.json';
import {
  BILL_COMMITTEE_COLUMNS,
  COMMITTEE_COLUMNS,
  COMMITTEE_MEETING_COLUMNS,
  COMMITTEE_MEMBER_COLUMNS,
  type BillCommittee,
  type Committee,
  type CommitteeMeeting,
  type CommitteeMember,
} from './committees';
import {
  SCOTUS_COLUMNS,
  SCOTUS_OUTCOME_COLUMNS,
  caseTopic,
  dedupeScotus,
  matchOutcomes,
  type CaseAbout,
  type ScotusCase,
  type ScotusOutcome,
} from './court';
import { EXECUTIVE_ORDER_COLUMNS, NOMINATION_COLUMNS, type ExecutiveOrder, type Nomination } from './executive';
import { FINANCE_COLUMNS, type MemberFinance } from './finance';
import type { UnityRow } from './insights';
import { STATE_COMMITTEE_COLUMNS, type StateCommittee, type StateExecutive, type StateSession } from './state-people';
import { DEMO } from './config';
import { DISCUSSION_COLUMNS } from './discussions';
import {
  CAPITAL_COLUMNS,
  CITY_BUDGET_COLUMNS,
  budgetSummary,
  HIDDEN_MATTER_TYPES,
  ZBA_COLUMNS,
  hiddenTypesFilter,
  docketTitle,
  type Report311,
  type CapitalProject,
  type CityBudgetLine,
  type ZbaAppeal,
  type ZbaDecisionCount,
} from './local';
import {
  annualCapital,
  bostonCapital,
  bostonOperating,
  printedOperating,
  type CapitalDocument,
  type CapitalItem,
  type CapitalView,
  type CityCommittee,
  type CityMeeting,
  type OperatingLine,
  type OperatingSummary,
} from './city';
import { voteAbout } from './votes';
import { committeeSlug } from '@civic/congress-client/boston-committees';
import {
  RestError,
  inList,
  rpc,
  select as restSelect,
  selectAll as restSelectAll,
  selectWithCount,
  type Params,
} from './rest';
import {
  BILL_LIST_COLUMNS,
  BILL_PAGE_COLUMNS,
  LOCAL_MATTER_COLUMNS,
  LOCAL_OFFICIAL_COLUMNS,
  MEMBER_COLUMNS,
  type Bill,
  type BillAction,
  type Cosponsor,
  type Discussion,
  type LocalMatter,
  type LocalMatterAction,
  type LocalOfficial,
  type Member,
  STATE_BILL_COLUMNS,
  type StateBill,
} from './types';

export const CURRENT_CONGRESS = congressForDate(new Date());

// ---- Demo mode: answer the same queries from the bundled sample data -------

const demo = demoData as unknown as Record<string, Record<string, unknown>[] | undefined>;
const DEMO_TABLES: Record<string, Record<string, unknown>[]> = {
  members: demo.members ?? [],
  bills: demo.bills ?? [],
  bill_actions: demo.actions ?? [],
  bill_cosponsors: demo.cosponsors ?? [],
  bill_subjects: demo.subjects ?? [],
  votes: demo.votes ?? [],
  vote_positions: demo.positions ?? [],
  member_vote_stats: demo.voteStats ?? [],
  state_legislators: demo.stateLegislators ?? [],
  state_bills: demo.stateBills ?? [],
  local_officials: demo.localOfficials ?? [],
  local_matters: demo.localMatters ?? [],
  local_matter_actions: demo.localMatterActions ?? [],
  local_matter_sponsors: demo.localMatterSponsors ?? [],
  local_meetings: demo.localMeetings ?? [],
  discussions: demo.discussions ?? [],
  council_districts: demo.councilDistricts ?? [],
  member_finance: demo.memberFinance ?? [],
};

/** A tiny PostgREST stand-in for the filters build-data uses (eq., like.prefix*, limit). Rows come pre-sorted. */
function demoQuery<T>(table: string, params: Params): T[] {
  let rows = DEMO_TABLES[table] ?? [];
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || ['select', 'order', 'limit', 'offset'].includes(key)) continue;
    const value = String(raw);
    if (value.startsWith('eq.')) rows = rows.filter((r) => String(r[key]) === value.slice(3));
    else if (value.startsWith('neq.')) rows = rows.filter((r) => String(r[key]) !== value.slice(4));
    else if (value === 'is.null') rows = rows.filter((r) => r[key] === null || r[key] === undefined);
    else if (value === 'not.is.null') rows = rows.filter((r) => r[key] !== null && r[key] !== undefined);
    else if (value.startsWith('not.in.(')) {
      const unwanted = new Set(
        value
          .slice(8, -1)
          .split(',')
          .map((v) => v.replace(/^"|"$/g, '')),
      );
      rows = rows.filter((r) => !unwanted.has(String(r[key])));
    } else if (value.startsWith('in.(')) {
      const wanted = new Set(
        value
          .slice(4, -1)
          .split(',')
          .map((v) => v.replace(/^"|"$/g, '')),
      );
      rows = rows.filter((r) => wanted.has(String(r[key])));
    } else if (value.startsWith('like.') && value.endsWith('*')) {
      const prefix = value.slice(5, -1);
      rows = rows.filter((r) => String(r[key]).startsWith(prefix));
    }
  }
  const limit = params.limit === undefined ? undefined : Number(params.limit);
  return (limit === undefined ? rows : rows.slice(0, limit)) as T[];
}

function selectAll<T>(table: string, params: Params = {}): Promise<T[]> {
  return DEMO ? Promise.resolve(demoQuery<T>(table, params)) : restSelectAll<T>(table, params);
}

/**
 * For tables and columns added after launch: when the migration is not applied yet
 * (PostgREST PGRST205 for a table, 42703 for a column) the read is empty instead
 * of failing the whole build.
 */
async function selectAllOptional<T>(table: string, params: Params = {}): Promise<T[]> {
  try {
    return await selectAll<T>(table, params);
  } catch (error) {
    if (error instanceof RestError && /PGRST205|42703/.test(error.message)) {
      console.warn(`[build-data] ${table} is not in the database yet; skipping it`);
      return [];
    }
    throw error;
  }
}

function select<T>(table: string, params: Params = {}): Promise<T[]> {
  return DEMO ? Promise.resolve(demoQuery<T>(table, params)) : restSelect<T>(table, params);
}

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

/**
 * Every current-Congress bill, list columns only (lists, counts, search). Summaries,
 * links and the other page fields come only for bills with their own page
 * (loadPrerenderBills): the full set read for all ~20,000 bills tripled what each
 * build downloads from Supabase.
 */
export const loadBills = memo(async () => {
  const rows = await selectAll<Bill>('bills', {
    select: DEMO ? BILL_PAGE_COLUMNS : BILL_LIST_COLUMNS,
    congress: `eq.${CURRENT_CONGRESS}`,
    order: 'latest_action_date.desc.nullslast,id.asc',
  });
  return MAX_BILL_PAGES ? rows.slice(0, MAX_BILL_PAGES) : rows;
});

// ---- Hybrid rendering: only notable items get prerendered pages -----------

/** Ids with a prerendered page. In demo mode every item in the snapshot is prerendered. */
export const loadPrerenderedBillIds = memo(async () => {
  if (DEMO) return new Set((await loadBills()).map((b) => b.id));
  const rows = await selectAll<{ id: string }>('bills_prerender', {
    select: 'id',
    congress: `eq.${CURRENT_CONGRESS}`,
    order: 'id.asc',
  });
  return new Set(rows.map((r) => r.id));
});

export const loadPrerenderBills = memo(async () => {
  const ids = await loadPrerenderedBillIds();
  if (DEMO) return (await loadBills()).filter((b) => ids.has(b.id));
  // Page columns for just these bills, in the list's order (latest action first).
  const full = new Map(
    (await selectByIds<Bill>('bills', 'id', [...ids], { select: BILL_PAGE_COLUMNS, order: 'id.asc' })).map((b) => [
      b.id,
      b,
    ]),
  );
  return (await loadBills()).filter((b) => full.has(b.id)).map((b) => full.get(b.id)!);
});

/** Fetch rows for many ids with `in.(…)` filters, 150 ids per request. */
async function selectByIds<T>(table: string, column: string, ids: string[], params: Params): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    out.push(...(await selectAll<T>(table, { ...params, [column]: inList(ids.slice(i, i + 150)) })));
  }
  return out;
}

const prerenderIds = async () => [...(await loadPrerenderedBillIds())];

export const loadActions = memo(async () => {
  const rows = await selectByIds<BillAction>('bill_actions', 'bill_id', await prerenderIds(), {
    select: 'bill_id,seq,action_date,text,chamber,source_system',
    order: 'bill_id.asc,seq.asc',
  });
  return groupBy(rows, (r) => r.bill_id);
});

export const loadCosponsors = memo(async () => {
  const rows = await selectByIds<Cosponsor>('bill_cosponsors', 'bill_id', await prerenderIds(), {
    select: 'bill_id,member_id,sponsored_date,withdrawn_date,is_original',
    order: 'bill_id.asc,member_id.asc',
  });
  return groupBy(rows, (r) => r.bill_id);
});

export const loadSubjects = memo(async () => {
  const rows = await selectByIds<{ bill_id: string; subject: string }>(
    'bill_subjects',
    'bill_id',
    await prerenderIds(),
    {
      select: 'bill_id,subject',
      order: 'bill_id.asc,subject.asc',
    },
  );
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.bill_id, [...(map.get(r.bill_id) ?? []), r.subject]);
  return map;
});

/** Active cosponsorships per member this Congress. */
export const loadCosponsorCounts = memo(async () => {
  if (DEMO) {
    const counts = new Map<string, number>();
    for (const r of DEMO_TABLES.bill_cosponsors as unknown as Cosponsor[]) {
      if (!r.withdrawn_date) counts.set(r.member_id, (counts.get(r.member_id) ?? 0) + 1);
    }
    return counts;
  }
  const rows = await selectAll<{ member_id: string; cosponsored: number }>('member_cosponsor_counts', {
    select: 'member_id,cosponsored',
    congress: `eq.${CURRENT_CONGRESS}`,
    order: 'member_id.asc',
  });
  return new Map(rows.map((r) => [r.member_id, r.cosponsored]));
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

export interface VoteSummary {
  id: string;
  chamber: 'house' | 'senate';
  roll_number: number;
  date: string | null;
  question: string | null;
  result: string | null;
  bill_id: string | null;
  /** The official title ("On Passage: H.R. 1, One Big Beautiful Bill Act"); what the vote was on. */
  title?: string | null;
  yea_total: number;
  nay_total: number;
  present_total: number;
  not_voting_total: number;
}

/** Every roll call this Congress, newest first. */
export const loadVotes = memo(async () =>
  selectAll<VoteSummary>('votes', {
    select:
      'id,chamber,roll_number,date,question,title,result,bill_id,yea_total,nay_total,present_total,not_voting_total',
    congress: `eq.${CURRENT_CONGRESS}`,
    order: 'date.desc.nullslast,id.desc',
  }),
);

/** Each vote with what it was on (the bill's number and short title, or a nominee). */
export const loadVotesAbout = memo(async () => {
  const [votes, bills] = await Promise.all([loadVotes(), loadBills()]);
  const titles = new Map(bills.map((b) => [b.id, b.short_title ?? b.title]));
  return votes.map((v) => ({ ...v, ...voteAbout(v, v.bill_id ? titles.get(v.bill_id) : null) }));
});

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

export { STATE_BILL_COLUMNS, type StateBill } from './types';

export const loadStateLegislators = memo(async () => {
  const rows = await selectAll<StateLegislator>('state_legislators', {
    select: 'id,name,party,state,chamber,district,title,photo_url,openstates_url',
    current: 'eq.true',
    order: 'state.asc,chamber.asc,id.asc',
  });
  return groupBy(rows, (r) => r.state);
});

/** Every state's committees (from openstates/people), by state; empty before the first load. */
export const loadStateCommittees = memo(async () => {
  const rows = await selectAllOptional<StateCommittee>('state_committees', {
    select: STATE_COMMITTEE_COLUMNS,
    order: 'state.asc,name.asc',
  });
  return groupBy(rows, (r) => r.state);
});

/** Governors and other statewide officials, by state (from openstates/people). */
export const loadStateExecutives = memo(async () => {
  const rows = await selectAllOptional<StateExecutive>('state_executives', {
    select: 'id,state,name,party,role,photo_url,email,offices,links',
    order: 'state.asc,name.asc',
  });
  return groupBy(rows, (r) => r.state);
});

export interface StateCourtCase {
  cluster_id: number;
  court_id: string;
  state: string;
  case_name: string;
  docket_number: string | null;
  date_filed: string;
  citations: string[];
  url: string;
  judges: string | null;
  dissents: number;
  concurrences: number;
  per_curiam: boolean;
  /** The reporter's subject keywords ("Homicide. Evidence, Hearsay."), from the opinion text. */
  keywords: string | null;
  /** The opinion's opening paragraph. */
  opening: string | null;
}

export interface StateExecutiveOrder {
  state: string;
  /** Sortable within a state: the order number in Massachusetts, 202603 for Connecticut's 26-3. */
  number: number;
  /** What the state calls it: "635", "26-3", "7OOO". Its page and discussion id use it lower-cased. */
  label: string;
  title: string;
  signed_date: string | null;
  governor: string | null;
  revokes: string | null;
  url: string;
  /** "No. 1583" in the Massachusetts Register. */
  register: string | null;
  /** What the order does, from the opening of what it orders (about 280 characters). */
  summary: string | null;
  /** Why, from its first WHEREAS clause (about 200 characters). */
  reason: string | null;
}

/** State high court decisions (CourtListener), newest first, by state. */
export const loadStateCourtCases = memo(async () => {
  const rows = await selectAllOptional<StateCourtCase>('state_court_cases', {
    select:
      'cluster_id,court_id,state,case_name,docket_number,date_filed,citations,url,judges,dissents,concurrences,per_curiam,keywords,opening',
    order: 'state.asc,date_filed.desc,cluster_id.desc',
  });
  return groupBy(rows, (r) => r.state);
});

/** Governors' executive orders, newest first, by state. */
export const loadStateOrders = memo(async () => {
  const rows = await selectAllOptional<StateExecutiveOrder>('state_executive_orders', {
    select: 'state,number,label,title,signed_date,governor,revokes,url,register,summary,reason',
    order: 'state.asc,signed_date.desc.nullslast,number.desc',
  });
  return groupBy(rows, (r) => r.state);
});

export interface StateBillCoverage {
  state: string;
  session: string;
  reported_total: number;
  loaded: number;
  checked_at: string;
}

/** Per state: bills Open States lists for the current session, and how many we hold. */
export const loadStateBillCoverage = memo(async () => {
  const rows = await selectAllOptional<StateBillCoverage>('state_bill_coverage', {
    select: 'state,session,reported_total,loaded,checked_at',
    order: 'state.asc',
  });
  return new Map(rows.map((r) => [r.state, r]));
});

/** Every state's legislative sessions with their dates, by state. */
export const loadStateSessions = memo(async () => {
  const rows = await selectAllOptional<StateSession>('state_sessions', {
    select: 'state,identifier,name,classification,start_date,end_date',
    order: 'state.asc',
  });
  return groupBy(rows, (r) => r.state);
});

/** Each state committee's chairs and co-chairs, by committee id. */
export const loadStateCommitteeChairs = memo(async () => {
  const rows = await selectAllOptional<{ committee_id: string; seq: number; person_id: string | null; name: string }>(
    'state_committee_members',
    { select: 'committee_id,seq,person_id,name', role: 'in.(chair,co-chair)', order: 'committee_id.asc,seq.asc' },
  );
  return groupBy(rows, (r) => r.committee_id);
});

/**
 * Communications, reports and petitions filed like bills ("Communication from the
 * Treasurer…", "Monthly report of…"); left out of "latest bills" lists, still searchable.
 */
export const STATE_BILL_FILLER =
  /^(communication|message|letter|petition of|report)\b|\b(monthly|quarterly|annual) report/i;

/**
 * The 10 most recently active bills for a state (leaving out filler and bills with no
 * recorded action yet), and how many bills it has (one request per state page).
 */
export async function loadRecentStateBills(state: string): Promise<{ bills: StateBill[]; total: number }> {
  const params = {
    select: STATE_BILL_COLUMNS,
    state: `eq.${state}`,
    order: 'latest_action_date.desc.nullslast,id.asc',
    limit: 40,
  };
  const latest = (rows: StateBill[]) =>
    rows.filter((b) => b.latest_action_text && !STATE_BILL_FILLER.test(b.title)).slice(0, 10);
  if (DEMO) {
    const bills = await select<StateBill>('state_bills', params);
    return { bills: latest(bills), total: bills.length };
  }
  const { rows, count } = await selectWithCount<StateBill>('state_bills', params);
  return { bills: latest(rows), total: count };
}

export interface VotePositionWithMember {
  member_id: string;
  position: 'yea' | 'nay' | 'present' | 'not_voting';
  party: string | null;
}

/** Demo mode only: positions are bundled so vote pages can be prerendered. */
export const loadPositionsByVote = memo(async () =>
  groupBy(await selectAll<VotePositionWithMember & { vote_id: string }>('vote_positions'), (p) => p.vote_id),
);

export const loadPositionsByMember = memo(async () =>
  groupBy(await selectAll<VotePositionWithMember & { vote_id: string }>('vote_positions'), (p) => p.member_id),
);

/** Party unity for the current Congress: party-line roll calls and votes with the party, per member and chamber. */
export const loadPartyUnity = memo(async () =>
  selectAllOptional<UnityRow>('member_party_unity', {
    select: 'member_id,congress,chamber,party,party_votes,with_party',
    congress: `eq.${CURRENT_CONGRESS}`,
  }),
);

/** Campaign finance (FEC) per member, keyed by bioguide ID. */
export const loadMemberFinance = memo(
  async () =>
    new Map(
      (
        await selectAllOptional<MemberFinance>('member_finance', { select: FINANCE_COLUMNS, order: 'member_id.asc' })
      ).map((f) => [f.member_id, f]),
    ),
);

// ---- Executive branch ---------------------------------------------------------

/** Executive orders since 2009, newest first. */
export const loadExecutiveOrders = memo(async () =>
  selectAllOptional<ExecutiveOrder>('executive_orders', {
    select: EXECUTIVE_ORDER_COLUMNS,
    signing_date: 'gte.2009-01-20',
    order: 'signing_date.desc.nullslast,eo_number.desc.nullslast',
  }),
);

/** Nominations received in the current Congress (civilian and military), latest action first. */
export const loadNominations = memo(async () =>
  selectAllOptional<Nomination>('nominations', {
    select: NOMINATION_COLUMNS,
    congress: `eq.${CURRENT_CONGRESS}`,
    order: 'latest_action_date.desc.nullslast,id.desc',
  }),
);

/** Senate roll calls on nominations, grouped by nomination id (newest first). */
export const loadVotesByNomination = memo(async () =>
  groupBy(
    await selectAllOptional<VoteSummary & { nomination_id: string }>('votes', {
      select:
        'id,chamber,roll_number,date,question,result,bill_id,yea_total,nay_total,present_total,not_voting_total,nomination_id',
      nomination_id: 'not.is.null',
      order: 'date.desc.nullslast,id.desc',
    }),
    (v) => v.nomination_id,
  ),
);

// ---- Committees ----------------------------------------------------------------

/** Current committees and subcommittees, by code. */
export const loadCommittees = memo(
  async () =>
    new Map(
      (
        await selectAllOptional<Committee>('committees', {
          select: COMMITTEE_COLUMNS,
          current: 'eq.true',
          order: 'code.asc',
        })
      ).map((c) => [c.code, c]),
    ),
);

export const loadCommitteeMembers = memo(async () =>
  selectAllOptional<CommitteeMember>('committee_members', {
    select: COMMITTEE_MEMBER_COLUMNS,
    order: 'committee_code.asc,rank.asc',
  }),
);

/** Referrals of current-Congress bills, grouped by committee and by bill. */
export const loadBillCommittees = memo(async () => {
  const rows = await selectAllOptional<BillCommittee>('bill_committees', {
    select: BILL_COMMITTEE_COLUMNS,
    bill_id: `like.${CURRENT_CONGRESS}-*`,
    order: 'bill_id.asc,committee_code.asc',
  });
  return { byCommittee: groupBy(rows, (r) => r.committee_code), byBill: groupBy(rows, (r) => r.bill_id) };
});

/** Hearings and markups this Congress, newest first. */
export const loadCommitteeMeetings = memo(async () =>
  selectAllOptional<CommitteeMeeting>('committee_meetings', {
    select: COMMITTEE_MEETING_COLUMNS,
    congress: `eq.${CURRENT_CONGRESS}`,
    order: 'date.desc.nullslast,id.desc',
  }),
);

// ---- Supreme Court ----------------------------------------------------------

/**
 * Supreme Court decisions (the last five terms), newest first. CourtListener sometimes
 * holds one decision as two or three clusters (same docket, same day); keep the first
 * (lowest id), so lists and per-term counts show each decision once.
 */
export const loadScotusCases = memo(async () => {
  const rows = await selectAllOptional<ScotusCase>('scotus_cases', {
    select: SCOTUS_COLUMNS,
    order: 'date_filed.desc,cluster_id.desc',
  });
  return dedupeScotus(rows);
});

/** Supreme Court Database outcomes (who won, vote split), from 2009. */
export const loadScotusOutcomes = memo(async () =>
  selectAllOptional<ScotusOutcome>('scotus_outcomes', {
    select: SCOTUS_OUTCOME_COLUMNS,
    order: 'term.desc,scdb_case_id.desc',
  }),
);

/** Each loaded decision's outcome, by CourtListener cluster id. */
export const loadScotusOutcomeMap = memo(async () =>
  matchOutcomes(await loadScotusCases(), await loadScotusOutcomes()),
);

/**
 * What each decision is about: the syllabus background (from CourtListener's opinion
 * text) and SCDB's topic. Read separately from the main columns so a database
 * without these columns yet still builds the court pages.
 */
export const loadCaseAbout = memo(async () => {
  const [summaries, topics, outcomes] = await Promise.all([
    selectAllOptional<{ cluster_id: number; syllabus_text: string }>('scotus_cases', {
      select: 'cluster_id,syllabus_text',
      syllabus_text: 'not.is.null',
    }),
    selectAllOptional<{ scdb_case_id: string; issue: number | null; issue_area: number | null }>('scotus_outcomes', {
      select: 'scdb_case_id,issue,issue_area',
      issue_area: 'not.is.null',
    }),
    loadScotusOutcomeMap(),
  ]);
  const topicById = new Map(topics.map((t) => [t.scdb_case_id, caseTopic(t.issue_area, t.issue)]));
  const about = new Map<number, CaseAbout>();
  for (const [clusterId, o] of outcomes) {
    const t = topicById.get(o.scdb_case_id);
    if (t && (t.area || t.issue)) about.set(clusterId, { ...t });
  }
  for (const s of summaries) about.set(s.cluster_id, { ...about.get(s.cluster_id), summary: s.syllabus_text });
  return about;
});

// ---- Cities -----------------------------------------------------------------
// Every loader takes a city key ("ma-boston"); each city's sources are turned into
// the shared shapes in lib/city.ts, so its pages are filled from whatever it has.

/** memo for loaders that take a city key. */
function memoByCity<T>(fn: (city: string) => Promise<T>): (city: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (city) => {
    let p = cache.get(city);
    if (!p) cache.set(city, (p = fn(city)));
    return p;
  };
}

/** The city's 311 report (the last 30 days and the 30 before), or null without 311 data. */
export const loadCity311 = memoByCity(async (city) => {
  const [row] = await selectAllOptional<{ report: Report311 }>('city_311_reports', {
    select: 'report',
    city: `eq.${city}`,
  });
  return row?.report ?? null;
});

/** Zoning decisions in the last year, counted per neighborhood and outcome. */
export const loadZbaDecisionCounts = memoByCity((city) =>
  selectAllOptional<ZbaDecisionCount>('zba_decision_counts', {
    select: 'neighborhood,decision,cases',
    city: `eq.${city}`,
    order: 'neighborhood.asc,decision.asc',
  }),
);

/** Zoning appeals with a hearing still to come. */
export const loadZbaAppeals = memoByCity((city) =>
  selectAllOptional<ZbaAppeal>('zba_appeals', {
    select: ZBA_COLUMNS,
    city: `eq.${city}`,
    order: 'hearing_date.asc,boa_apno.asc',
  }),
);

/** The operating budget, from line-item data (Boston) or a printed summary (Worcester); null without either. */
export const loadCityOperating = memoByCity(async (city): Promise<OperatingSummary | null> => {
  const [lines, docs, printed] = await Promise.all([
    selectAllOptional<CityBudgetLine>('city_budget_lines', {
      select: CITY_BUDGET_COLUMNS,
      city: `eq.${city}`,
      order: 'kind.asc,fiscal_year.asc,dept.asc,grouping.asc,line.asc,basis.asc',
    }),
    selectAllOptional<{
      fiscal_year: number;
      stage: 'proposed' | 'adopted';
      title: string;
      source_url: string;
      columns: string[];
    }>('local_operating_documents', {
      select: 'fiscal_year,stage,title,source_url,columns',
      city: `eq.${city}`,
      order: 'fiscal_year.desc',
    }),
    selectAllOptional<OperatingLine & { fiscal_year: number }>('local_operating_lines', {
      select: 'fiscal_year,kind,seq,grp,label,amounts',
      city: `eq.${city}`,
      order: 'kind.asc,seq.asc',
    }),
  ]);
  if (lines.length) return bostonOperating(budgetSummary(lines.map((l) => ({ ...l, amount: Number(l.amount) }))));
  const doc = docs[0];
  if (!doc) return null;
  return printedOperating(
    doc,
    printed.filter((l) => l.fiscal_year === doc.fiscal_year).map((l) => ({ ...l, amounts: l.amounts.map(Number) })),
  );
});

/** Capital projects: a multi-year plan (Boston) or annual budgets (Worcester); null without either. */
export const loadCityCapital = memoByCity(async (city): Promise<CapitalView | null> => {
  const [plan, docs, items] = await Promise.all([
    selectAllOptional<CapitalProject>('capital_projects', {
      select: CAPITAL_COLUMNS,
      city: `eq.${city}`,
      order: 'total_budget.desc,proj_id.asc',
    }),
    selectAllOptional<CapitalDocument>('local_capital_documents', {
      select: 'fiscal_year,stage,title,source_url,plan_years,plan',
      city: `eq.${city}`,
      order: 'fiscal_year.desc',
    }),
    selectAllOptional<CapitalItem>('local_capital_items', {
      select:
        'fiscal_year,stage,seq,department,category,title,description,borrowing,cash,new_authorization,prior_authorization,grants',
      city: `eq.${city}`,
      order: 'fiscal_year.desc,seq.asc',
    }),
  ]);
  if (plan.length)
    return bostonCapital(
      plan.map((p) => ({
        ...p,
        total_budget: Number(p.total_budget),
        spent: Number(p.spent),
        year0: Number(p.year0),
        year1: Number(p.year1),
        years_2_5: Number(p.years_2_5),
        external_funds: Number(p.external_funds),
      })),
      city,
    );
  const num = (i: CapitalItem): CapitalItem => ({
    ...i,
    borrowing: Number(i.borrowing),
    cash: Number(i.cash),
    new_authorization: Number(i.new_authorization),
    prior_authorization: Number(i.prior_authorization),
    grants: Number(i.grants),
  });
  return annualCapital(
    docs.map((doc) => ({
      doc,
      items: items.filter((i) => i.fiscal_year === doc.fiscal_year && i.stage === doc.stage).map(num),
    })),
    city,
  );
});

export const loadCityOfficials = memoByCity((city) =>
  (DEMO ? select : selectAllOptional)<LocalOfficial>('local_officials', {
    select: LOCAL_OFFICIAL_COLUMNS,
    city: `eq.${city}`,
    current: 'eq.true',
    order: 'district.asc.nullslast,name.asc',
  }),
);

/** Most recently active council matters, consent-agenda resolutions left out (the default list). */
export const loadRecentLocalMatters = memoByCity((city) =>
  select<LocalMatter>('local_matters', {
    select: LOCAL_MATTER_COLUMNS,
    city: `eq.${city}`,
    type: hiddenTypesFilter(),
    order: 'latest_action_date.desc.nullslast,last_modified.desc',
    limit: 10,
  }),
);

/**
 * Counts for the council matters filters: every type; statuses and the total over
 * the default list (consent-agenda resolutions left out), so they match it.
 */
export const loadLocalMatterFacets = memoByCity(async (city) => {
  const rows = await selectAllOptional<{ type: string | null; status: string | null }>('local_matters', {
    select: 'type,status',
    city: `eq.${city}`,
    order: 'id.asc',
  });
  const shown = rows.filter((r) => !HIDDEN_MATTER_TYPES.includes(r.type ?? ''));
  const count = (list: typeof rows, key: 'type' | 'status') => {
    const map = new Map<string, number>();
    for (const r of list) if (r[key]) map.set(r[key]!, (map.get(r[key]!) ?? 0) + 1);
    return [...map].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count);
  };
  return { types: count(rows, 'type'), statuses: count(shown, 'status'), total: shown.length };
});

/**
 * Council and committee meetings, newest first, with the dockets on committee
 * agendas where the city records them. A joint meeting some systems list once per
 * committee is kept once.
 */
export const loadCityMeetings = memoByCity(async (city): Promise<CityMeeting[]> => {
  const rows = await (DEMO ? select : selectAllOptional)<
    Omit<CityMeeting, 'items' | 'committees' | 'status'> & {
      committees?: string[] | null;
      status?: string | null;
    }
  >('local_meetings', {
    select: 'id,date,time,starts_at,location,agenda_url,minutes_url,legistar_url,status,committees',
    city: `eq.${city}`,
    order: 'date.desc,id.desc',
  });
  const seen = new Set<string>();
  const meetings = rows
    .map((m) => ({ ...m, committees: m.committees ?? [], status: m.status ?? null }))
    .filter((m) => {
      const key = `${m.date}|${m.time}|${[...m.committees].sort().join('+')}`;
      if (m.committees.length && seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const withCommittee = meetings.filter((m) => m.committees.length > 0).map((m) => m.id);
  const items = withCommittee.length
    ? await selectByIds<CityMeeting['items'][number] & { meeting_id: string }>(
        'local_meeting_items',
        'meeting_id',
        withCommittee,
        { select: 'meeting_id,seq,matter_id,file_number,title', order: 'meeting_id.asc,seq.asc' },
      ).catch(() => [])
    : [];
  // Agenda lines are often procedural ("On the message and order, referred on…"); use the docket's own title.
  const matterIds = [...new Set(items.map((i) => i.matter_id).filter((id): id is string => Boolean(id)))];
  const titles = new Map(
    (matterIds.length
      ? await selectByIds<{ id: string; title: string }>('local_matters', 'id', matterIds, {
          select: 'id,title',
          order: 'id.asc',
        })
      : []
    ).map((m) => [m.id, m.title]),
  );
  const byMeeting = groupBy(
    items.map((i) => {
      const stored = Boolean(i.matter_id && titles.has(i.matter_id));
      return { ...i, stored, title: stored ? titles.get(i.matter_id!)! : docketTitle(i.title) };
    }),
    (i) => i.meeting_id,
  );
  return meetings.map((m) => ({ ...m, items: byMeeting.get(m.id) ?? [] }));
});

/**
 * The council's committees: those the city lists (with members and descriptions
 * where it publishes them), plus any other committee its meetings name.
 */
export const loadCityCommittees = memoByCity(async (city): Promise<CityCommittee[]> => {
  const [committees, meetings] = await Promise.all([
    selectAllOptional<Omit<CityCommittee, 'members'>>('local_committees', {
      select: 'id,slug,name,description,url',
      city: `eq.${city}`,
      order: 'name.asc',
    }),
    loadCityMeetings(city),
  ]);
  const members = committees.length
    ? await selectByIds<CityCommittee['members'][number] & { committee_id: string }>(
        'local_committee_members',
        'committee_id',
        committees.map((c) => c.id),
        { select: 'committee_id,seq,official_id,name,role', order: 'committee_id.asc,seq.asc' },
      )
    : [];
  const by = groupBy(members, (m) => m.committee_id);
  const listed = committees.map((c) => ({ ...c, members: by.get(c.id) ?? [] }));
  const known = new Set(listed.map((c) => c.name));
  const others = [...new Set(meetings.flatMap((m) => m.committees))]
    .filter((name) => !known.has(name))
    .map((name) => {
      const slug = committeeSlug(name);
      return { id: `${city}-${slug}`, slug, name, description: null, url: null, members: [] };
    });
  return [...listed, ...others].sort((a, b) => a.name.localeCompare(b.name));
});

export interface LocalSponsorship {
  matter_id: string;
  official_id: string;
  name: string | null;
  sequence: number | null;
}

/** Council matters with a prerendered page, every city (all of them in demo mode). */
export const loadPrerenderLocalMatters = memo(async () => {
  const ids = DEMO
    ? (DEMO_TABLES.local_matters as unknown as LocalMatter[]).map((m) => m.id)
    : (await selectAll<{ id: string }>('local_matters_prerender', { select: 'id', order: 'id.asc' })).map((r) => r.id);
  const [matters, actions, sponsors] = await Promise.all([
    selectByIds<LocalMatter>('local_matters', 'id', ids, { select: LOCAL_MATTER_COLUMNS, order: 'id.asc' }),
    selectByIds<LocalMatterAction>('local_matter_actions', 'matter_id', ids, { order: 'matter_id.asc,seq.asc' }),
    selectByIds<LocalSponsorship>('local_matter_sponsors', 'matter_id', ids, {
      select: 'matter_id,official_id,name,sequence',
      order: 'matter_id.asc,sequence.asc',
    }),
  ]);
  const actionsBy = groupBy(actions, (a) => a.matter_id);
  const sponsorsBy = groupBy(sponsors, (s) => s.matter_id);
  return matters.map((matter) => ({
    matter,
    actions: actionsBy.get(matter.id) ?? [],
    sponsors: sponsorsBy.get(matter.id) ?? [],
  }));
});

/** Matters a councilor sponsored, newest first (councilor pages). */
export async function loadSponsoredMatters(officialId: string): Promise<LocalMatter[]> {
  if (DEMO) {
    const ids = new Set(
      (DEMO_TABLES.local_matter_sponsors as unknown as LocalSponsorship[])
        .filter((s) => s.official_id === officialId)
        .map((s) => s.matter_id),
    );
    return (DEMO_TABLES.local_matters as unknown as LocalMatter[]).filter((m) => ids.has(m.id));
  }
  // Light rows for every matter (the counts and filters), full rows only for the ten shown first.
  const rows = await selectAllOptional<{ matter: LocalMatter | null }>('local_matter_sponsors', {
    select: 'matter:local_matters(id,matter_id,type,status,passed_date,latest_action_date)',
    official_id: `eq.${officialId}`,
  });
  const light = rows
    .map((r) => r.matter)
    .filter((m): m is LocalMatter => m !== null)
    .sort((a, b) => (b.latest_action_date ?? '').localeCompare(a.latest_action_date ?? ''));
  const firstIds = light
    .filter((m) => !HIDDEN_MATTER_TYPES.includes(m.type ?? ''))
    .slice(0, SPONSORED_FIRST)
    .map((m) => m.id);
  const full = new Map(
    (
      await selectByIds<LocalMatter>('local_matters', 'id', firstIds, { select: LOCAL_MATTER_COLUMNS, order: 'id.asc' })
    ).map((m) => [m.id, m]),
  );
  return light.map((m) => full.get(m.id) ?? m);
}

/** How many of a councilor's matters their page lists before the explorer takes over. */
export const SPONSORED_FIRST = 10;

export interface DistrictShape {
  district: number;
  name: string | null;
  /** GeoJSON geometry (MultiPolygon), simplified for display. */
  geojson: string;
}

/** A city's council district outlines, for its map. */
export const loadCouncilDistricts = memoByCity(async (city) =>
  DEMO
    ? city === 'ma-boston'
      ? (DEMO_TABLES.council_districts as unknown as DistrictShape[])
      : []
    : rpc<DistrictShape[]>('council_district_shapes', { p_city: city }).catch(() => [] as DistrictShape[]),
);

// ---- Massachusetts and other state bills -----------------------------------

/** State bills with a prerendered page (see the state_bills_prerender view). */
export const loadPrerenderStateBills = memo(async () => {
  const ids = DEMO
    ? (DEMO_TABLES.state_bills as unknown as StateBill[]).map((b) => b.id)
    : (await selectAll<{ id: string }>('state_bills_prerender', { select: 'id', order: 'id.asc' })).map((r) => r.id);
  return selectByIds<StateBill>('state_bills', 'id', ids, { select: STATE_BILL_COLUMNS, order: 'id.asc' });
});

// ---- Discussions --------------------------------------------------------------

/** Published discussions (open and closed). Drafts are never public. */
export const loadDiscussions = memo(async () =>
  selectAll<Discussion>('discussions', {
    select: DISCUSSION_COLUMNS,
    status: 'neq.draft',
    order: 'created_at.desc',
  }),
);

/** target "type:id" → discussion, for linking bills and matters to their discussion. */
export const loadDiscussionsByTarget = memo(async () => {
  const map = new Map<string, Discussion>();
  for (const d of await loadDiscussions())
    if (d.target_type && d.target_id) map.set(`${d.target_type}:${d.target_id}`, d);
  return map;
});
