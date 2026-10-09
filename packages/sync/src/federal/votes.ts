/**
 * Roll-call votes.
 *
 * House: list a session's roll calls from Congress.gov, then one `/members`
 * request per new or corrected vote (it carries the question, result and every
 * member's position keyed by Bioguide ID). Note: the API covers legislation-
 * related House votes only (no Speaker elections or quorum calls).
 *
 * Senate: senate.gov's session menu lists roll calls; each new one is fetched as
 * XML. Senators are identified by LIS ID and mapped to Bioguide IDs through
 * `members.lis_id` (from congress-legislators), falling back to last name +
 * state. Official totals come from the file's own <count> block.
 *
 * Each vote tied to a bill emits one feed event for that bill.
 */
import {
  billId,
  billLabel,
  normalizePosition,
  senateDocTypeToBillType,
  voteHtmlUrl,
  voteId,
  type CongressClient,
  type HouseVoteListItem,
  type SenateClient,
  type SenateVote,
  type VotePosition,
} from '@civic/congress-client';
import { upsertIfChanged, type Sql } from '../db.ts';
import { partyCode, stateCode, toTimestamp } from '../text.ts';
import { writeFeedEvents, type FeedEventRow } from './events.ts';
import { nominationIdFromSenate } from './executive.ts';

export interface VoteRow extends Record<string, unknown> {
  id: string;
  chamber: 'house' | 'senate';
  congress: number;
  session: number;
  roll_number: number;
  date: string | null;
  question: string | null;
  title: string | null;
  vote_type: string | null;
  majority_requirement: string | null;
  result: string | null;
  bill_id: string | null;
  amendment: string | null;
  yea_total: number;
  nay_total: number;
  present_total: number;
  not_voting_total: number;
  source_url: string | null;
  source_updated_at: string | null;
  /** Senate votes on a nomination (confirmation, cloture), e.g. "119-pn615-2". */
  nomination_id?: string | null;
}

export interface PositionRow {
  vote_id: string;
  member_id: string;
  position: VotePosition;
  party: string | null;
}

export interface VoteWriteResult {
  rowsWritten: number;
  isNew: boolean;
  unmatched: number;
}

export function totals(positions: { position: VotePosition }[]) {
  const t = { yea_total: 0, nay_total: 0, present_total: 0, not_voting_total: 0 };
  for (const p of positions) {
    if (p.position === 'yea') t.yea_total += 1;
    else if (p.position === 'nay') t.nay_total += 1;
    else if (p.position === 'present') t.present_total += 1;
    else t.not_voting_total += 1;
  }
  return t;
}

/** "House vote on H.R. 30: On Passage. Passed 274–145." */
export function voteSummary(
  vote: Pick<VoteRow, 'chamber' | 'question' | 'result' | 'yea_total' | 'nay_total' | 'bill_id'>,
) {
  const chamber = vote.chamber === 'house' ? 'House' : 'Senate';
  const ref = vote.bill_id?.split('-');
  const label = ref && ref.length === 3 ? billLabel(ref[1]!, ref[2]!) : null;
  const what = label ? `${chamber} vote on ${label}` : `${chamber} vote`;
  const tally = `${vote.yea_total}–${vote.nay_total}`;
  return `${what}: ${vote.question ?? 'Roll call'}. ${vote.result ?? ''} ${tally}.`
    .replace(/\s+/g, ' ')
    .replace(' .', '.');
}

export function voteEvent(vote: VoteRow): FeedEventRow | null {
  if (!vote.bill_id) return null;
  return {
    target_type: 'bill',
    target_id: vote.bill_id,
    kind: 'vote',
    member_type: null,
    member_id: null,
    occurred_at: vote.date ?? new Date().toISOString(),
    summary: voteSummary(vote),
    payload: {
      vote_id: vote.id,
      chamber: vote.chamber,
      question: vote.question,
      result: vote.result,
      yea: vote.yea_total,
      nay: vote.nay_total,
    },
    dedupe_key: `vote:${vote.id}`,
  };
}

/** Write a vote and its positions in one transaction; positions are replaced only if they changed. */
export async function writeVote(sql: Sql, vote: VoteRow, positions: PositionRow[]): Promise<VoteWriteResult> {
  let written = 0;
  let isNew = false;
  await sql.begin(async (tx) => {
    const [existing] = await tx`select 1 from public.votes where id = ${vote.id}`;
    isNew = !existing;
    if (await upsertIfChanged(tx, 'public.votes', ['id'], vote)) written += 1;
    for (const p of positions) {
      if (
        await upsertIfChanged(
          tx,
          'public.vote_positions',
          ['vote_id', 'member_id'],
          p as unknown as Record<string, unknown>,
        )
      ) {
        written += 1;
      }
    }
    const keep = positions.map((p) => p.member_id);
    const removed = await tx`
      delete from public.vote_positions where vote_id = ${vote.id} and member_id <> all(${keep}::text[]) returning 1`;
    written += removed.length;
    const event = voteEvent(vote);
    if (event) written += await writeFeedEvents(tx, [event]);
  });
  return { rowsWritten: written, isNew, unmatched: 0 };
}

// ---- House -------------------------------------------------------------------

function houseBillId(congress: number, type?: string, number?: string): string | null {
  if (!type || !number) return null;
  const t = type.toLowerCase();
  if (!['hr', 'hres', 'hjres', 'hconres', 's', 'sres', 'sjres', 'sconres'].includes(t)) return null;
  return billId(congress, t, number);
}

async function ensureMembers(
  sql: Sql,
  ids: Map<string, { name: string; party: string | null; state: string | null; chamber: 'house' | 'senate' }>,
) {
  if (ids.size === 0) return 0;
  const known = await sql<{ bioguide_id: string }[]>`
    select bioguide_id from public.members where bioguide_id = any(${[...ids.keys()]}::text[])`;
  const have = new Set(known.map((k) => k.bioguide_id));
  let written = 0;
  for (const [id, m] of ids) {
    if (have.has(id)) continue;
    const result = await sql`
      insert into public.members (bioguide_id, name, party, state, chamber, current)
      values (${id}, ${m.name}, ${m.party}, ${m.state}, ${m.chamber}, false)
      on conflict (bioguide_id) do nothing returning 1`;
    written += result.length;
  }
  return written;
}

export async function syncHouseVote(
  sql: Sql,
  client: CongressClient,
  congress: number,
  session: number,
  roll: number,
  listItem?: HouseVoteListItem,
) {
  const data = await client.getHouseVoteMembers(congress, session, roll);
  const id = voteId('house', congress, session, roll);
  const positions: PositionRow[] = [];
  const stubs = new Map<string, { name: string; party: string | null; state: string | null; chamber: 'house' }>();
  for (const r of data.results ?? []) {
    const member = r.bioguideID ?? r.bioguideId;
    if (!member) continue;
    positions.push({
      vote_id: id,
      member_id: member,
      position: normalizePosition(r.voteCast),
      party: partyCode(r.voteParty),
    });
    stubs.set(member, {
      name: [r.firstName, r.lastName].filter(Boolean).join(' ') || member,
      party: partyCode(r.voteParty),
      state: stateCode(r.voteState),
      chamber: 'house',
    });
  }
  const vote: VoteRow = {
    id,
    chamber: 'house',
    congress,
    session,
    roll_number: roll,
    date: toTimestamp(data.startDate ?? listItem?.startDate),
    question: data.voteQuestion ?? null,
    title: listItem?.amendmentAuthor ?? null,
    vote_type: data.voteType ?? listItem?.voteType ?? null,
    majority_requirement: /2\/3/.test(data.voteType ?? '') ? '2/3' : null,
    result: data.result ?? listItem?.result ?? null,
    bill_id: houseBillId(
      congress,
      data.legislationType ?? listItem?.legislationType,
      data.legislationNumber ?? listItem?.legislationNumber,
    ),
    amendment: listItem?.amendmentNumber ? `H.Amdt. ${listItem.amendmentNumber}` : null,
    ...totals(positions),
    source_url:
      data.sourceDataURL ??
      `https://clerk.house.gov/Votes/${new Date(data.startDate ?? Date.now()).getUTCFullYear()}${String(roll).padStart(3, '0')}`,
    source_updated_at: toTimestamp(data.updateDate ?? listItem?.updateDate),
  };
  const stubWrites = await ensureMembers(sql, stubs);
  const result = await writeVote(sql, vote, positions);
  return { ...result, rowsWritten: result.rowsWritten + stubWrites, vote };
}

export const VOTES_JOB = 'federal-votes';

export interface VotesCursor extends Record<string, unknown> {
  /** Senate: highest roll number synced per `${congress}-${session}`. */
  senate?: Record<string, number>;
}

export interface SyncVotesOptions {
  congress: number;
  sessions: number[];
  client: CongressClient;
  senate: SenateClient;
  outOfTime: () => boolean;
  log: (message: string, data?: Record<string, unknown>) => void;
  /** Senate roll calls to fetch per run at most (politeness to senate.gov). */
  senateLimit?: number;
  /** Pause between senate.gov requests. */
  senateDelayMs?: number;
}

/** House: new or updated roll calls for the given sessions. */
export async function syncHouseVotes(
  sql: Sql,
  options: SyncVotesOptions,
): Promise<{ rowsWritten: number; votes: number; complete: boolean }> {
  let rowsWritten = 0;
  let votes = 0;
  // Newest first, so a partial load (backfill, a short run) already shows the latest roll calls.
  for (const session of [...options.sessions].sort((a, b) => b - a)) {
    const stored = new Map(
      (
        await sql<{ roll_number: number; source_updated_at: string | null }[]>`
          select roll_number, source_updated_at from public.votes
           where chamber = 'house' and congress = ${options.congress} and session = ${session}`
      ).map((r) => [r.roll_number, r.source_updated_at ? new Date(r.source_updated_at).getTime() : 0]),
    );
    const list: HouseVoteListItem[] = [];
    for await (const item of options.client.listHouseVotes(options.congress, session)) list.push(item);
    const todo = list
      .filter((v) => v.rollCallNumber !== undefined)
      .filter((v) => {
        const have = stored.get(v.rollCallNumber!);
        if (have === undefined) return true;
        const upstream = v.updateDate ? new Date(v.updateDate).getTime() : 0;
        return upstream > have;
      })
      .sort((a, b) => b.rollCallNumber! - a.rollCallNumber!);
    for (const item of todo) {
      if (options.outOfTime()) return { rowsWritten, votes, complete: false };
      const result = await syncHouseVote(sql, options.client, options.congress, session, item.rollCallNumber!, item);
      rowsWritten += result.rowsWritten;
      votes += 1;
    }
  }
  return { rowsWritten, votes, complete: true };
}

// ---- Senate ------------------------------------------------------------------

export async function lisMap(sql: Sql) {
  const rows = await sql<
    { bioguide_id: string; lis_id: string | null; last_name: string | null; name: string; state: string | null }[]
  >`
    select bioguide_id, lis_id, last_name, name, state from public.members where chamber = 'senate' or lis_id is not null`;
  const byLis = new Map(rows.filter((r) => r.lis_id).map((r) => [r.lis_id!, r.bioguide_id]));
  const byNameState = new Map<string, string>();
  for (const r of rows) {
    const last = (r.last_name ?? r.name.split(' ').at(-1) ?? '').toLowerCase();
    if (r.state) byNameState.set(`${last}|${r.state}`, r.bioguide_id);
  }
  return { byLis, byNameState };
}

export function senateVoteRow(v: SenateVote): VoteRow {
  const type = senateDocTypeToBillType(v.document?.type ?? null);
  const congress = v.document?.congress ?? v.congress;
  return {
    id: voteId('senate', v.congress, v.session, v.rollNumber),
    chamber: 'senate',
    congress: v.congress,
    session: v.session,
    roll_number: v.rollNumber,
    date: v.date ? new Date(v.date).toISOString() : null,
    question: v.questionText ?? v.question,
    title: v.title,
    vote_type: null,
    majority_requirement: v.majorityRequirement,
    result: v.result,
    bill_id: type && v.document?.number ? billId(congress, type, v.document.number) : null,
    amendment: v.amendmentNumber,
    // Official totals: the file's own count block.
    yea_total: v.stated.yea,
    nay_total: v.stated.nay,
    present_total: v.stated.present,
    not_voting_total: v.stated.notVoting,
    source_url: voteHtmlUrl(v.congress, v.session, v.rollNumber),
    source_updated_at: v.modifyDate ? new Date(v.modifyDate).toISOString() : null,
    nomination_id:
      v.document?.type === 'PN' && v.document.number ? nominationIdFromSenate(congress, v.document.number) : null,
  };
}

export async function syncSenateVote(
  sql: Sql,
  senate: SenateClient,
  congress: number,
  session: number,
  roll: number,
  maps?: Awaited<ReturnType<typeof lisMap>>,
) {
  const v = await senate.getVote(congress, session, roll);
  const map = maps ?? (await lisMap(sql));
  const vote = senateVoteRow(v);
  const positions: PositionRow[] = [];
  let unmatched = 0;
  for (const m of v.members) {
    const id = map.byLis.get(m.lisId) ?? map.byNameState.get(`${(m.lastName ?? '').toLowerCase()}|${m.state ?? ''}`);
    if (!id) {
      unmatched += 1;
      continue;
    }
    positions.push({ vote_id: vote.id, member_id: id, position: m.position, party: partyCode(m.party) });
  }
  const result = await writeVote(sql, vote, positions);
  return { ...result, unmatched, totalsMatchCount: v.totalsMatchCount, vote };
}

export async function syncSenateVotes(
  sql: Sql,
  cursor: VotesCursor,
  options: SyncVotesOptions,
): Promise<{ rowsWritten: number; votes: number; cursor: VotesCursor; unmatched: number; complete: boolean }> {
  const done = { ...(cursor.senate ?? {}) };
  let rowsWritten = 0;
  let votes = 0;
  let unmatched = 0;
  const limit = options.senateLimit ?? 50;
  const maps = await lisMap(sql);
  // Newest first, like the House. Roll calls already stored are skipped, so the order is free.
  for (const session of [...options.sessions].sort((a, b) => b - a)) {
    const key = `${options.congress}-${session}`;
    let menu;
    try {
      menu = await options.senate.getMenu(options.congress, session);
    } catch (error) {
      // No menu yet (e.g. the first days of a session) is not an error.
      options.log('senate menu unavailable', { key, error: (error as Error).message });
      continue;
    }
    const stored = new Set(
      (
        await sql<{ roll_number: number }[]>`
          select roll_number from public.votes
           where chamber = 'senate' and congress = ${options.congress} and session = ${session}`
      ).map((r) => r.roll_number),
    );
    const todo = menu.votes
      .map((v) => v.rollNumber)
      .filter((n) => !stored.has(n))
      .sort((a, b) => b - a);
    for (const roll of todo) {
      if (options.outOfTime() || votes >= limit) {
        return { rowsWritten, votes, cursor: { ...cursor, senate: done }, unmatched, complete: false };
      }
      if (votes > 0 && options.senateDelayMs) await new Promise((r) => setTimeout(r, options.senateDelayMs));
      const result = await syncSenateVote(sql, options.senate, options.congress, session, roll, maps);
      if (!result.totalsMatchCount) options.log('senate totals differ from count block', { vote: result.vote.id });
      rowsWritten += result.rowsWritten;
      unmatched += result.unmatched;
      votes += 1;
      done[key] = Math.max(done[key] ?? 0, roll);
    }
  }
  return { rowsWritten, votes, cursor: { ...cursor, senate: done }, unmatched, complete: true };
}

/** Sessions to check: the current one, plus the previous one for two weeks after a new session starts. */
export function sessionsToSync(now: Date): number[] {
  const year = now.getUTCFullYear();
  const beforeJan3 = now.getUTCMonth() === 0 && now.getUTCDate() < 3;
  const effective = beforeJan3 ? year - 1 : year;
  const session = effective % 2 === 1 ? 1 : 2;
  const earlyInYear = now.getUTCMonth() === 0 && now.getUTCDate() < 17 && !beforeJan3;
  return session === 2 && earlyInYear ? [1, 2] : [session];
}

/**
 * One run of the votes job, used by sync-federal and the backfill. The Senate goes first because
 * it is capped per run (senateLimit); the House then uses the rest of the time. Each chamber
 * resumes where it stopped, so neither waits for the other to finish.
 */
export async function syncVotes(
  sql: Sql,
  cursor: VotesCursor,
  options: SyncVotesOptions,
): Promise<{ cursor: VotesCursor; rowsWritten: number; complete: boolean; house: number; senate: number }> {
  const senate = await syncSenateVotes(sql, cursor, options);
  if (senate.unmatched > 0) options.log('senate positions without a known senator', { count: senate.unmatched });
  const house = options.outOfTime()
    ? { rowsWritten: 0, votes: 0, complete: false }
    : await syncHouseVotes(sql, options);
  return {
    cursor: senate.cursor,
    rowsWritten: house.rowsWritten + senate.rowsWritten,
    complete: senate.complete && house.complete,
    house: house.votes,
    senate: senate.votes,
  };
}
