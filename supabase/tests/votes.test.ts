import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SenateClient } from '@civic/congress-client';
import { sessionsToSync, syncVotes, type Sql, type VotesCursor } from '@civic/sync';
import { asUser, createUser } from './auth.ts';
import { connect, reloadSeed } from './db.ts';
import { FakeCongress, fixtureJson } from './fake-congress.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixtureText = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../packages/congress-client/test/fixtures/${path}`, import.meta.url)), 'utf8');

beforeAll(async () => {
  // Real members from the seed (federal reps, Senate LIS ids).
  await reloadSeed(sql as never);
});

beforeEach(async () => {
  await sql`truncate public.votes, public.vote_positions, public.feed_events, public.follows cascade`;
  await sql`delete from auth.users where email like '%@example.test'`;
});

function fakeHouse() {
  const api = new FakeCongress();
  const members = fixtureJson('congress/house-vote-17-members.json').houseRollCallVoteMemberVotes;
  const { results: _r, ...header } = members;
  api.houseVotes.push({ ...header, url: '' });
  api.houseVoteMembers.set('119-1-17', members);
  return api;
}

function fakeSenate(menuVotes: number[] = [1]) {
  const menu = `<?xml version="1.0"?><vote_summary><congress>119</congress><session>1</session><congress_year>2025</congress_year><votes>${menuVotes
    .map((n) => `<vote><vote_number>${String(n).padStart(5, '0')}</vote_number><vote_date>09-Jan</vote_date></vote>`)
    .join('')}</votes></vote_summary>`;
  const requests: string[] = [];
  const client = new SenateClient({
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url).includes('vote_menu_119_1')) return new Response(menu);
      if (String(url).includes('vote_119_1_00001.xml')) return new Response(fixtureText('senate/vote_119_1_00001.xml'));
      return new Response('missing', { status: 404 });
    },
  });
  return { client, requests };
}

const quiet = () => undefined;

async function run(api: FakeCongress, senate: SenateClient, cursor: VotesCursor = {}) {
  return syncVotes(sql, cursor, {
    congress: 119,
    sessions: [1],
    client: api.client(),
    senate,
    outOfTime: () => false,
    log: quiet,
  });
}

describe('vote sync', () => {
  it('loads a House roll call with every position and totals matching the Clerk', async () => {
    const api = fakeHouse();
    const result = await run(api, fakeSenate([]).client);
    expect(result.house).toBe(1);
    const [vote] = await sql`select * from public.votes where id = 'house-119-1-17'`;
    // House Clerk roll 17 (2025): H.R. 30 passed 274-145, 15 not voting.
    expect(vote).toMatchObject({
      chamber: 'house',
      question: 'On Passage',
      result: 'Passed',
      bill_id: '119-hr-30',
      yea_total: 274,
      nay_total: 145,
      present_total: 0,
      not_voting_total: 15,
      source_url: 'https://clerk.house.gov/evs/2025/roll017.xml',
    });
    const [count] = await sql`select count(*)::int as n from public.vote_positions where vote_id = 'house-119-1-17'`;
    expect(count!.n).toBe(434);
    const [event] =
      await sql`select target_id, kind, summary from public.feed_events where dedupe_key = 'vote:house-119-1-17'`;
    expect(event).toMatchObject({
      target_id: '119-hr-30',
      kind: 'vote',
      summary: 'House vote on H.R. 30: On Passage. Passed 274–145.',
    });

    // A second run with no upstream change fetches only the list and writes nothing.
    api.requests.length = 0;
    const again = await run(api, fakeSenate([]).client);
    expect(again.rowsWritten).toBe(0);
    expect(api.requests.map((u) => u.pathname)).toEqual(['/v3/house-vote/119/1']);

    // A correction upstream (newer updateDate) is re-fetched.
    api.houseVotes[0].updateDate = '2026-10-01T00:00:00-04:00';
    api.requests.length = 0;
    await run(api, fakeSenate([]).client);
    expect(api.requests.map((u) => u.pathname)).toContain('/v3/house-vote/119/1/17/members');
  });

  it('loads a Senate roll call, maps LIS ids to Bioguide ids and keeps the official totals', async () => {
    const senate = fakeSenate([1]);
    const result = await run(new FakeCongress(), senate.client);
    expect(result.senate).toBe(1);
    expect(result.cursor.senate).toEqual({ '119-1': 1 });
    const [vote] = await sql`select * from public.votes where id = 'senate-119-1-1'`;
    expect(vote).toMatchObject({
      chamber: 'senate',
      bill_id: '119-s-5',
      yea_total: 84,
      nay_total: 9,
      present_total: 0,
      not_voting_total: 6,
      majority_requirement: '3/5',
      question: 'On Cloture on the Motion to Proceed S. 5',
    });
    const positions = await sql`select member_id, position from public.vote_positions where vote_id = 'senate-119-1-1'`;
    // Senators still serving are mapped; those who left since (not in the current-members seed) are skipped.
    expect(positions.length).toBeGreaterThanOrEqual(95);
    const alsobrooks = positions.find((p) => p.member_id === 'A000382');
    expect(alsobrooks?.position).toBe('yea');

    // Next run: nothing new on the menu, no vote XML fetched.
    senate.requests.length = 0;
    await run(new FakeCongress(), senate.client, result.cursor);
    expect(senate.requests.every((u) => u.includes('vote_menu'))).toBe(true);
  });
});

describe('vote views and feed', () => {
  it('computes party agreement and shows followed members’ votes in their feed', async () => {
    await run(fakeHouse(), fakeSenate([]).client);
    await sql`select private.refresh_member_stats()`;
    const [stats] = await sql`select * from public.member_vote_stats where member_id = 'A000055'`;
    expect(stats).toMatchObject({ total_votes: 1, votes_cast: 1, missed: 0, with_party: 1, party_line_votes: 1 });

    const recent =
      await sql`select vote_id, position, question from public.member_votes where member_id = 'A000148' order by date desc`;
    expect(recent).toEqual([{ vote_id: 'house-119-1-17', position: 'nay', question: 'On Passage' }]);

    const user = await createUser(sql);
    await asUser(
      sql,
      user,
      (tx) =>
        tx`insert into public.follows (user_id, target_type, target_id) values (${user}, 'member', 'A000055'), (${user}, 'bill', '119-hr-30')`,
    );
    const feed = await asUser(
      sql,
      user,
      (tx) => tx`select kind, target_type, summary, reason, payload from public.feed order by target_type`,
    );
    expect(feed.map((f) => [f.kind, f.target_type, f.reason])).toEqual([
      ['vote', 'bill', 'target'],
      ['vote', 'member', 'legislator'],
    ]);
    expect(feed[1]!.summary).toBe('Robert B. Aderholt voted yes: On Passage');
    expect(feed[1]!.payload).toMatchObject({ vote_id: 'house-119-1-17', position: 'yea' });
  });
});

describe('sessionsToSync', () => {
  it('checks the previous session for two weeks into a new one', () => {
    expect(sessionsToSync(new Date('2026-10-08T00:00:00Z'))).toEqual([2]);
    expect(sessionsToSync(new Date('2026-01-10T00:00:00Z'))).toEqual([1, 2]);
    expect(sessionsToSync(new Date('2025-06-01T00:00:00Z'))).toEqual([1]);
  });
});
