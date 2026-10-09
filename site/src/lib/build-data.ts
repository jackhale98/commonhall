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
import { SCOTUS_COLUMNS, SCOTUS_OUTCOME_COLUMNS, matchOutcomes, type ScotusCase, type ScotusOutcome } from './court';
import { EXECUTIVE_ORDER_COLUMNS, NOMINATION_COLUMNS, type ExecutiveOrder, type Nomination } from './executive';
import { FINANCE_COLUMNS, type MemberFinance } from './finance';
import { DEMO } from './config';
import { DISCUSSION_COLUMNS } from './discussions';
import {
  CAPITAL_COLUMNS,
  HIDDEN_MATTER_TYPES,
  ZBA_COLUMNS,
  hiddenTypesFilter,
  type CapitalProject,
  type ZbaAppeal,
} from './local';
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
  type LocalMeeting,
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

export const loadBills = memo(async () => {
  const rows = await selectAll<Bill>('bills', {
    select: BILL_PAGE_COLUMNS,
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
  return (await loadBills()).filter((b) => ids.has(b.id));
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

export { STATE_BILL_COLUMNS, type StateBill } from './types';

export const loadStateLegislators = memo(async () => {
  const rows = await selectAll<StateLegislator>('state_legislators', {
    select: 'id,name,party,state,chamber,district,title,photo_url,openstates_url',
    current: 'eq.true',
    order: 'state.asc,chamber.asc,id.asc',
  });
  return groupBy(rows, (r) => r.state);
});

/** The 10 most recently active bills for a state, and how many it has (one request per state page). */
export async function loadRecentStateBills(state: string): Promise<{ bills: StateBill[]; total: number }> {
  const params = {
    select: STATE_BILL_COLUMNS,
    state: `eq.${state}`,
    order: 'latest_action_date.desc.nullslast,id.asc',
    limit: 10,
  };
  if (DEMO) {
    const bills = await select<StateBill>('state_bills', params);
    return { bills, total: bills.length };
  }
  const { rows, count } = await selectWithCount<StateBill>('state_bills', params);
  return { bills: rows, total: count };
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

/** Supreme Court decisions (the last five terms), newest first. */
export const loadScotusCases = memo(async () =>
  selectAllOptional<ScotusCase>('scotus_cases', {
    select: SCOTUS_COLUMNS,
    order: 'date_filed.desc,cluster_id.desc',
  }),
);

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

// ---- Boston -----------------------------------------------------------------

/** Zoning Board of Appeal cases (open, or heard in the last year), latest hearing first. */
export const loadZbaAppeals = memo(async () =>
  selectAllOptional<ZbaAppeal>('zba_appeals', {
    select: ZBA_COLUMNS,
    order: 'hearing_date.desc.nullslast,boa_apno.asc',
  }),
);

/** Boston Capital Plan projects, largest budget first. */
export const loadCapitalProjects = memo(async () =>
  (
    await selectAllOptional<CapitalProject>('capital_projects', {
      select: CAPITAL_COLUMNS,
      order: 'total_budget.desc,proj_id.asc',
    })
  ).map((p) => ({ ...p, total_budget: Number(p.total_budget), year1: Number(p.year1), spent: Number(p.spent) })),
);

export const loadLocalOfficials = memo(async () =>
  selectAll<LocalOfficial>('local_officials', {
    select: LOCAL_OFFICIAL_COLUMNS,
    city: 'eq.boston',
    current: 'eq.true',
    order: 'id.asc',
  }),
);

/** Most recently active council matters, consent-agenda resolutions left out (the default list). */
export const loadRecentLocalMatters = memo(async () =>
  select<LocalMatter>('local_matters', {
    select: LOCAL_MATTER_COLUMNS,
    city: 'eq.boston',
    type: hiddenTypesFilter(),
    order: 'latest_action_date.desc.nullslast,last_modified.desc',
    limit: 10,
  }),
);

/**
 * Counts for the Boston matters filters: every type; statuses and the total over
 * the default list (consent-agenda resolutions left out), so they match it.
 */
export const loadLocalMatterFacets = memo(async () => {
  const rows = await selectAll<{ type: string | null; status: string | null }>('local_matters', {
    select: 'type,status',
    city: 'eq.boston',
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

export const loadLocalMeetings = memo(async () =>
  select<LocalMeeting>('local_meetings', {
    select: 'id,event_id,body,starts_at,date,time,location,agenda_url,minutes_url,legistar_url',
    city: 'eq.boston',
    order: 'date.desc',
    limit: 40,
  }),
);

export interface LocalSponsorship {
  matter_id: string;
  official_id: string;
  name: string | null;
  sequence: number | null;
}

/** Council matters with a prerendered page (all of them in demo mode). */
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

/** Matters each councilor sponsored, newest first (councilor pages). */
export async function loadSponsoredMatters(officialId: string): Promise<LocalMatter[]> {
  if (DEMO) {
    const ids = new Set(
      (DEMO_TABLES.local_matter_sponsors as unknown as LocalSponsorship[])
        .filter((s) => s.official_id === officialId)
        .map((s) => s.matter_id),
    );
    return (DEMO_TABLES.local_matters as unknown as LocalMatter[]).filter((m) => ids.has(m.id));
  }
  const rows = await selectAll<{ matter: LocalMatter | null }>('local_matter_sponsors', {
    select: `matter:local_matters(${LOCAL_MATTER_COLUMNS})`,
    official_id: `eq.${officialId}`,
  });
  return rows
    .map((r) => r.matter)
    .filter((m): m is LocalMatter => m !== null)
    .sort((a, b) => (b.latest_action_date ?? '').localeCompare(a.latest_action_date ?? ''));
}

export interface DistrictShape {
  district: number;
  name: string | null;
  /** GeoJSON geometry (MultiPolygon), simplified for display. */
  geojson: string;
}

/** Council district outlines for the Boston map. */
export const loadCouncilDistricts = memo(async () =>
  DEMO
    ? (DEMO_TABLES.council_districts as unknown as DistrictShape[])
    : rpc<DistrictShape[]>('council_district_shapes', { p_city: 'boston' }),
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
