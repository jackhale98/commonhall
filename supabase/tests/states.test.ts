import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CensusGeocoder, OpenStatesClient, RequestBudget, type FetchLike } from '@civic/congress-client';
import {
  OPENSTATES_API,
  STATE_JOB,
  dailyBudget,
  findReps,
  runJob,
  syncStates,
  type Sql,
  type StateCursor,
} from '@civic/sync';
import { asUser, createUser } from './auth.ts';
import { connect, reloadSeed } from './db.ts';
import { fixtureJson } from './fake-congress.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

interface FakeBill {
  id: string;
  session: string;
  identifier: string;
  title: string;
  updated_at: string;
  latest_action_date: string;
  latest_action_description: string;
  sponsor?: string;
  cosponsors?: string[];
  subjects?: string[];
  abstract?: string;
  votes?: unknown[];
}

class FakeOpenStates {
  sessions: Record<string, string> = { tx: '89', ca: '20252026' };
  people: Record<string, { id: string; name: string; party: string; chamber: string; district: string }[]> = {
    tx: [
      { id: 'ocd-person/tx-1', name: 'Sarah Eckhardt', party: 'Democratic', chamber: 'upper', district: '14' },
      { id: 'ocd-person/tx-2', name: 'Gina Hinojosa', party: 'Democratic', chamber: 'lower', district: '49' },
      { id: 'ocd-person/tx-3', name: 'Someone Else', party: 'Republican', chamber: 'lower', district: '1' },
    ],
    ca: [],
  };
  bills: Record<string, FakeBill[]> = { tx: [], ca: [] };
  requests: URL[] = [];

  addBills(
    state: string,
    n: number,
    start = 1,
    updated = (i: number) =>
      `2026-03-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00.${String(i).padStart(6, '0')}+00:00`,
  ) {
    for (let i = start; i < start + n; i++) {
      this.bills[state]!.push({
        id: `ocd-bill/${state}-${i}`,
        session: this.sessions[state]!,
        identifier: `HB ${i}`,
        title: `Relating to test ${i}.`,
        updated_at: updated(i),
        latest_action_date: '2026-03-01',
        latest_action_description: 'Referred to committee',
        sponsor: 'ocd-person/tx-2',
      });
    }
  }

  json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch: FetchLike = async (input) => {
    const url = new URL(input);
    this.requests.push(url);
    const jur = url.searchParams.get('jurisdiction') ?? '';
    const state = /state:([a-z]{2})/.exec(jur)?.[1] ?? '';
    if (url.pathname === '/jurisdictions') {
      return this.json({
        results: Object.entries(this.sessions).map(([s, id]) => ({
          id: `ocd-jurisdiction/country:us/state:${s}/government`,
          name: s.toUpperCase(),
          classification: 'state',
          legislative_sessions: [
            { identifier: id, name: id, classification: 'primary', start_date: '2025-01-01', end_date: '2027-12-31' },
          ],
        })),
        pagination: { per_page: 52, page: 1, max_page: 1, total_items: 2 },
      });
    }
    if (url.pathname === '/people') {
      const results = (this.people[state] ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        party: p.party,
        current_role: {
          title: p.chamber === 'upper' ? 'Senator' : 'Representative',
          org_classification: p.chamber,
          district: p.district,
        },
        jurisdiction: {
          id: `ocd-jurisdiction/country:us/state:${state}/government`,
          name: state,
          classification: 'state',
        },
        openstates_url: `https://openstates.org/person/${p.id}`,
      }));
      return this.json({ results, pagination: { per_page: 50, page: 1, max_page: 1, total_items: results.length } });
    }
    if (url.pathname === '/people.geo') {
      const results = this.people
        .tx!.filter((p) => ['14', '49'].includes(p.district))
        .map((p) => ({
          id: p.id,
          name: p.name,
          party: p.party,
          current_role: { title: 'x', org_classification: p.chamber, district: p.district },
          jurisdiction: {
            id: 'ocd-jurisdiction/country:us/state:tx/government',
            name: 'Texas',
            classification: 'state',
          },
        }));
      // people.geo also returns federal members; they must be ignored.
      results.push({
        id: 'ocd-person/federal',
        name: 'Federal Person',
        party: 'D',
        current_role: { title: 'Senator', org_classification: 'upper', district: 'TX' },
        jurisdiction: {
          id: 'ocd-jurisdiction/country:us/government',
          name: 'United States',
          classification: 'country',
        },
      });
      return this.json({ results, pagination: { per_page: 50, page: 1, max_page: 1, total_items: results.length } });
    }
    if (url.pathname === '/bills') {
      const since = url.searchParams.get('updated_since');
      const page = Number(url.searchParams.get('page') ?? 1);
      const perPage = Number(url.searchParams.get('per_page') ?? 20);
      const desc = url.searchParams.get('sort') === 'updated_desc';
      const includes = url.searchParams.getAll('include');
      const all = (this.bills[state] ?? [])
        .filter((b) => b.session === url.searchParams.get('session'))
        .filter((b) => !since || b.updated_at >= since)
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
      if (desc) all.reverse();
      const slice = all.slice((page - 1) * perPage, page * perPage);
      return this.json({
        results: slice.map((b) => ({
          id: b.id,
          session: b.session,
          jurisdiction: {
            id: `ocd-jurisdiction/country:us/state:${state}/government`,
            name: state,
            classification: 'state',
          },
          from_organization: { classification: 'lower' },
          identifier: b.identifier,
          title: b.title,
          classification: ['bill'],
          openstates_url: `https://openstates.org/${state}/bills/${b.session}/${b.identifier.replace(' ', '')}/`,
          first_action_date: '2026-03-01',
          latest_action_date: b.latest_action_date,
          latest_action_description: b.latest_action_description,
          updated_at: b.updated_at,
          subject: b.subjects ?? [],
          ...(includes.includes('abstracts') ? { abstracts: b.abstract ? [{ abstract: b.abstract }] : [] } : {}),
          ...(includes.includes('actions')
            ? {
                actions: [
                  { description: 'Filed', date: '2026-03-01', order: 1, organization: { classification: 'lower' } },
                  {
                    description: b.latest_action_description,
                    date: b.latest_action_date,
                    order: 2,
                    organization: { classification: 'lower' },
                  },
                ],
              }
            : {}),
          ...(includes.includes('votes') ? { votes: b.votes ?? [] } : {}),
          sponsorships: [
            ...(b.cosponsors ?? []).map((name) => ({ name, primary: false, classification: 'cosponsor' })),
            ...(b.sponsor
              ? [{ name: 'Gina Hinojosa', primary: true, person: { id: b.sponsor, name: 'Gina Hinojosa' } }]
              : []),
          ],
        })),
        pagination: {
          per_page: perPage,
          page,
          max_page: Math.max(1, Math.ceil(all.length / perPage)),
          total_items: all.length,
        },
      });
    }
    return this.json({ detail: 'not found' }, 404);
  };

  client(limit = 1000) {
    return new OpenStatesClient({
      apiKey: 'k',
      fetch: this.fetch,
      budget: new RequestBudget(limit, OPENSTATES_API),
      minIntervalMs: 0,
    });
  }
}

async function runState(api: FakeOpenStates, limit = 1000, states = ['TX', 'CA'], at = '2026-10-08T07:00:00Z') {
  const client = api.client(limit);
  return runJob<StateCursor>({
    sql,
    job: STATE_JOB,
    timeLimitMs: 60_000,
    budgets: { [OPENSTATES_API]: client.budget },
    log: () => undefined,
    run: (ctx) => syncStates(ctx, { client, states, now: () => new Date(at) }),
  });
}

beforeAll(async () => {
  // Real members from the seed (federal reps, Senate LIS ids).
  await reloadSeed(sql as never);
});

beforeEach(async () => {
  await sql`truncate public.state_vote_positions, public.state_votes, public.state_bill_actions, public.state_sessions, public.state_bill_sponsors, public.state_bills, public.state_legislators, public.geo_cache, public.feed_events, public.follows, public.state_bill_counts`;
  await sql`delete from public.sync_state`;
  await sql`delete from public.sync_lock`;
  await sql`delete from public.api_usage`;
  await sql`delete from auth.users where email like '%@example.test'`;
});

describe('sync-state', () => {
  it('loads every current-session bill, then only what changed', async () => {
    const api = new FakeOpenStates();
    api.addBills('tx', 45);
    const first = await runState(api);
    expect(first.status).toBe('ok');
    const bills = Number((await sql`select count(*)::int as n from public.state_bills where state = 'TX'`)[0]!.n);
    expect(bills).toBe(45);
    const [bill] = await sql`select * from public.state_bills where id = 'ocd-bill/tx-1'`;
    expect(bill).toMatchObject({
      state: 'TX',
      session: '89',
      identifier: 'HB 1',
      chamber: 'lower',
      primary_sponsor_id: 'ocd-person/tx-2',
    });
    // The first full load of a state writes no feed events.
    const events = await sql`select * from public.feed_events`;
    expect(events).toHaveLength(0);
    const cursor = (first.cursor as StateCursor).bills!.TX!;
    expect(cursor.filled).toBe(true);

    // Next night: one bill moves, one is new. Only those are written, each with an event.
    const moved = api.bills.tx![4]!;
    moved.latest_action_description = 'Passed the House';
    moved.latest_action_date = '2026-10-07';
    moved.updated_at = '2026-10-07T23:00:00.000000+00:00';
    api.addBills('tx', 1, 46, () => '2026-10-07T23:30:00.000000+00:00');
    api.requests.length = 0;
    const second = await runState(api, 1000, ['TX', 'CA'], '2026-10-09T07:00:00Z');
    const txBillRequests = api.requests.filter((u) => u.pathname === '/bills' && u.search.includes('state%3Atx'));
    expect(txBillRequests).toHaveLength(1);
    expect(second.rowsWritten).toBeGreaterThanOrEqual(4);
    const kinds =
      await sql`select kind, target_id, member_type, member_id, summary from public.feed_events order by kind`;
    expect(kinds.map((k) => [k.kind, k.target_id])).toEqual([
      ['action', 'ocd-bill/tx-5'],
      ['new_bill', 'ocd-bill/tx-46'],
    ]);
    expect(kinds[0]!.summary).toBe('TX HB 5: Passed the House');
    expect(kinds[1]).toMatchObject({ member_type: 'state_legislator', member_id: 'ocd-person/tx-2' });
  });

  it('records how many bills the session has, about weekly, for the coverage line', async () => {
    const api = new FakeOpenStates();
    api.addBills('tx', 45);
    await runState(api);
    const coverage = async () =>
      (await sql`select reported_total, loaded from public.state_bill_coverage where state = 'TX'`)[0];
    expect(await coverage()).toEqual({ reported_total: 45, loaded: 45 });

    api.addBills('tx', 2, 46, () => '2026-10-08T23:30:00.000000+00:00');
    // The next night needs no count; a week on, one request recounts the session.
    api.requests.length = 0;
    await runState(api, 1000, ['TX', 'CA'], '2026-10-09T07:00:00Z');
    expect(await coverage()).toEqual({ reported_total: 45, loaded: 47 });
    await runState(api, 1000, ['TX', 'CA'], '2026-10-16T07:00:00Z');
    expect(await coverage()).toEqual({ reported_total: 47, loaded: 47 });
  });

  it('keeps every sponsor for Massachusetts, primary first, and only the main sponsor elsewhere', async () => {
    const api = new FakeOpenStates();
    api.sessions = { ma: '194', tx: '89' };
    api.bills = { ma: [], tx: [] };
    api.addBills('ma', 3);
    api.addBills('tx', 3);
    api.bills.ma![0]!.cosponsors = ['Ana Hernández', 'Jolanda Jones'];
    api.bills.tx![0]!.cosponsors = ['Someone Else'];
    await runState(api, 1000, ['MA', 'TX']);
    const rows = await sql`
      select seq, person_id, name, is_primary from public.state_bill_sponsors
       where bill_id = 'ocd-bill/ma-1' order by seq`;
    expect(rows).toEqual([
      { seq: 0, person_id: 'ocd-person/tx-2', name: 'Gina Hinojosa', is_primary: true },
      { seq: 1, person_id: null, name: 'Ana Hernández', is_primary: false },
      { seq: 2, person_id: null, name: 'Jolanda Jones', is_primary: false },
    ]);
    const tx = await sql`select count(*)::int as n from public.state_bill_sponsors where bill_id = 'ocd-bill/tx-1'`;
    expect(tx[0]!.n).toBe(0);
    const [main] = await sql`select primary_sponsor_id from public.state_bills where id = 'ocd-bill/tx-1'`;
    expect(main!.primary_sponsor_id).toBe('ocd-person/tx-2');

    const bill = api.bills.ma![0]!;
    bill.cosponsors = ['Ana Hernández'];
    bill.updated_at = '2026-10-07T23:00:00.000000+00:00';
    await runState(api, 1000, ['MA', 'TX'], '2026-10-09T07:00:00Z');
    const after = await sql`select name from public.state_bill_sponsors where bill_id = 'ocd-bill/ma-1' order by seq`;
    expect(after.map((r) => r.name)).toEqual(['Gina Hinojosa', 'Ana Hernández']);
  });

  it('keeps Massachusetts histories, roll calls and summaries, topics for every state, and session dates', async () => {
    const api = new FakeOpenStates();
    api.sessions = { ma: '194', tx: '89' };
    api.bills = { ma: [], tx: [] };
    api.addBills('ma', 2);
    api.addBills('tx', 2);
    const ma = api.bills.ma![0]!;
    ma.subjects = ['Housing', 'Taxation'];
    ma.abstract = 'Relative to affordable housing.';
    const position = (id: string, option: string) => ({
      option,
      voter_name: id,
      voter: { id: `ocd-person/${id}`, name: id },
    });
    ma.votes = [
      {
        id: 'ocd-vote/ma-1',
        motion_text: 'Passage',
        start_date: '2026-06-01',
        result: 'pass',
        organization: { classification: 'lower' },
        counts: [
          { option: 'yes', value: 3 },
          { option: 'no', value: 2 },
          { option: 'not voting', value: 1 },
        ],
        votes: [
          position('d1', 'yes'),
          position('d2', 'no'),
          position('d3', 'yes'),
          position('r1', 'no'),
          position('r2', 'no'),
          position('r3', 'not voting'),
        ],
      },
    ];
    api.bills.tx![0]!.subjects = ['Education'];
    for (const [id, party] of [
      ['d1', 'Democratic'],
      ['d2', 'Democratic'],
      ['d3', 'Democratic'],
      ['r1', 'Republican'],
      ['r2', 'Republican'],
      ['r3', 'Republican'],
    ]) {
      await sql`
        insert into public.state_legislators (id, name, party, state, chamber, current)
        values (${`ocd-person/${id}`}, ${id}, ${party}, 'MA', 'lower', true)`;
    }
    await runState(api, 1000, ['MA', 'TX']);

    const [bill] = await sql`select subjects, abstract from public.state_bills where id = ${ma.id}`;
    expect(bill).toEqual({ subjects: ['Housing', 'Taxation'], abstract: 'Relative to affordable housing.' });
    const [tx] = await sql`select subjects, abstract from public.state_bills where id = 'ocd-bill/tx-1'`;
    expect(tx).toEqual({ subjects: ['Education'], abstract: null });

    const actions =
      await sql`select seq, description, chamber from public.state_bill_actions where bill_id = ${ma.id} order by seq`;
    expect(actions.map((a) => a.description)).toEqual(['Filed', ma.latest_action_description]);
    expect(
      (await sql`select count(*)::int as n from public.state_bill_actions where bill_id like 'ocd-bill/tx-%'`)[0]!.n,
    ).toBe(0);

    const [vote] =
      await sql`select motion, result, chamber, yes, no, other from public.state_votes where id = 'ocd-vote/ma-1'`;
    expect(vote).toEqual({ motion: 'Passage', result: 'pass', chamber: 'lower', yes: 3, no: 2, other: 1 });
    const unity = await sql`select person_id, with_party, party_votes from public.state_party_unity order by person_id`;
    expect(unity.map((u) => [u.person_id, u.with_party, u.party_votes])).toEqual([
      ['ocd-person/d1', 1, 1],
      ['ocd-person/d2', 0, 1],
      ['ocd-person/d3', 1, 1],
      ['ocd-person/r1', 1, 1],
      ['ocd-person/r2', 1, 1],
    ]);

    const sessions = await sql`select state, identifier, start_date::text from public.state_sessions order by state`;
    expect(sessions.map((r) => [r.state, r.identifier])).toEqual([
      ['MA', '194'],
      ['TX', '89'],
    ]);

    // Re-reading a bill whose history, votes and sponsors haven't changed rewrites only
    // the bill row (its update time moved), not its children.
    ma.updated_at = '2026-10-07T23:00:00.000000+00:00';
    const again = await runState(api, 1000, ['MA', 'TX'], '2026-10-09T07:00:00Z');
    expect(again.rowsWritten).toBe(1);
  });

  it('gets through a full page of bills that share one timestamp', async () => {
    const api = new FakeOpenStates();
    api.addBills('tx', 50, 1, () => '2026-05-01T00:00:00.000000+00:00');
    await runState(api);
    const n = Number((await sql`select count(*)::int as n from public.state_bills`)[0]!.n);
    expect(n).toBe(50);
  });

  it('drops the previous session’s bills when a new session starts', async () => {
    const api = new FakeOpenStates();
    api.addBills('tx', 3);
    await runState(api);
    api.sessions.tx = '90';
    api.bills.tx = [];
    api.addBills('tx', 2, 100);
    // Force a session refresh by ageing the check.
    await sql`update public.sync_state set cursor = jsonb_set(cursor, '{sessionsCheckedAt}', '"2026-01-01T00:00:00Z"') where job = ${STATE_JOB}`;
    await runState(api);
    const rows = await sql`select id, session from public.state_bills order by id`;
    expect(rows.map((r) => r.session)).toEqual(['90', '90']);
  });

  it('respects the daily request budget', async () => {
    await sql`select public.record_api_usage(${OPENSTATES_API}, 440)`;
    const budget = await dailyBudget(sql, OPENSTATES_API, 450, 200);
    expect(budget.limit).toBe(10);
    const api = new FakeOpenStates();
    api.addBills('tx', 300);
    const result = await runState(api, budget.limit);
    expect(result.status).toBe('ok');
    expect(api.requests.length).toBeLessThanOrEqual(10);
    const cursor = result.cursor as StateCursor;
    expect(cursor.bills?.TX?.filled).not.toBe(true); // resumes next night
  });

  it('lets users follow state bills and see their actions', async () => {
    const api = new FakeOpenStates();
    api.addBills('tx', 2);
    await runState(api);
    const user = await createUser(sql);
    await asUser(
      sql,
      user,
      (tx) =>
        tx`insert into public.follows (user_id, target_type, target_id) values (${user}, 'state_bill', 'ocd-bill/tx-2')`,
    );
    api.bills.tx![1]!.latest_action_description = 'Signed by the Governor';
    api.bills.tx![1]!.updated_at = '2026-10-07T00:00:00.000000+00:00';
    await runState(api, 1000, ['TX', 'CA'], '2026-10-09T07:00:00Z');
    const feed = await asUser(sql, user, (tx) => tx`select kind, summary, payload from public.feed`);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ kind: 'action', summary: 'TX HB 2: Signed by the Governor' });
    expect(feed[0]!.payload.openstates_url).toMatch(/openstates\.org\/tx\/bills/);
  });

  it('spends Open States requests on bills only: legislators come from the weekly people load', async () => {
    const api = new FakeOpenStates();
    api.addBills('tx', 100);
    // Sessions (1) + one page of bills.
    const result = await runState(api, 2);
    expect(result.status).toBe('ok');
    expect(api.requests.filter((u) => u.pathname === '/people')).toHaveLength(0);
    expect(api.requests.filter((u) => u.pathname === '/bills')).toHaveLength(1);
  });

  it('reads a state’s newest bills first, then catches up from where the load began', async () => {
    const api = new FakeOpenStates();
    api.addBills('tx', 100);
    // Sessions (1) + one page of bills: it holds the 20 newest.
    await runState(api, 2, ['TX']);
    const newest = [...api.bills.tx!].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 20);
    const stored = await sql`select id from public.state_bills order by id`;
    expect(new Set(stored.map((r) => r.id))).toEqual(new Set(newest.map((b) => b.id)));
    // The rest arrive on later runs; once loaded, the state catches up oldest-first.
    await runState(api, 1000, ['TX']);
    expect(Number((await sql`select count(*)::int as n from public.state_bills`)[0]!.n)).toBe(100);
    const [state] = await sql`select cursor from public.sync_state where job = ${STATE_JOB}`;
    expect(state!.cursor.bills.TX).toMatchObject({ filled: true, since: newest[0]!.updated_at });
  });

  it('gives Massachusetts about half the requests and every other state a turn', async () => {
    const api = new FakeOpenStates();
    api.sessions = { ma: '194', tx: '89', ca: '20252026' };
    api.bills = { ma: [], tx: [], ca: [] };
    api.people = { ...api.people, ma: [] };
    api.addBills('ma', 400);
    api.addBills('tx', 200);
    api.addBills('ca', 200);
    // Sessions (1) + 16 pages of bills.
    await runState(api, 17, ['MA', 'TX', 'CA']);
    const pagesFor = (st: string) =>
      api.requests.filter((u) => u.pathname === '/bills' && u.search.includes(`state%3A${st}`)).length;
    expect(pagesFor('ma')).toBe(8);
    expect(pagesFor('tx')).toBe(4);
    expect(pagesFor('ca')).toBe(4);
  });

  it('finishes a part-loaded state newest-first, stopping at the bills it already has', async () => {
    const api = new FakeOpenStates();
    api.addBills('tx', 100);
    const sorted = [...api.bills.tx!].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    // An earlier oldest-first load stored the 30 oldest and stopped.
    const since = sorted[29]!.updated_at;
    await sql`insert into public.sync_state (job, cursor) values (${STATE_JOB}, ${sql.json({
      sessions: { TX: '89', CA: '20252026' },
      sessionsCheckedAt: '2026-10-08T00:00:00Z',
      legislatorsAt: { TX: '2026-10-08T00:00:00Z', CA: '2026-10-08T00:00:00Z' },
      bills: { TX: { session: '89', since, page: 1 } },
    })})`;
    api.requests.length = 0;
    await runState(api);
    // Pages of 20, newest first: page 4 reaches the stored bills, so page 5 is never read.
    const txPages = api.requests.filter((u) => u.pathname === '/bills' && u.search.includes('state%3Atx'));
    expect(txPages.map((u) => [u.searchParams.get('sort'), u.searchParams.get('page')])).toEqual([
      ['updated_desc', '1'],
      ['updated_desc', '2'],
      ['updated_desc', '3'],
      ['updated_desc', '4'],
    ]);
    // This test's database didn't hold the 20 oldest; a real one would.
    expect(Number((await sql`select count(*)::int as n from public.state_bills where state = 'TX'`)[0]!.n)).toBe(80);
  });
});

describe('find my reps', () => {
  function census(): CensusGeocoder {
    const fetch: FetchLike = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/onelineaddress'))
        return new Response(JSON.stringify(fixtureJson('census/austin-current.json')));
      if (url.searchParams.get('vintage') === 'ACS2025_Current') {
        return new Response(JSON.stringify(fixtureJson('census/austin-acs2025-coords.json')));
      }
      return new Response(JSON.stringify({ result: { geographies: {} } }));
    };
    return new CensusGeocoder({ fetch });
  }

  it('returns the sitting House member (119th lines), both senators and state legislators', async () => {
    const api = new FakeOpenStates();
    const result = await findReps(
      sql,
      { census: census(), openstates: () => api.client() },
      '1100 Congress Ave, Austin, TX 78701',
      119,
    );
    expect(result).toMatchObject({
      state: 'TX',
      congressionalDistrict: 37,
      stateUpper: '14',
      stateLower: '49',
      stateSource: 'openstates',
    });
    const senators = result!.federal.filter((m) => m.chamber === 'senate');
    const house = result!.federal.filter((m) => m.chamber === 'house');
    expect(senators).toHaveLength(2);
    expect(house).toHaveLength(1);
    expect(house[0]).toMatchObject({ state: 'TX', district: 37 });
    expect(result!.stateLegislators.map((l) => l.name).sort()).toEqual(['Gina Hinojosa', 'Sarah Eckhardt']);

    // Legislators were stored so they can be followed; the lookup is cached by coordinates.
    const n = Number((await sql`select count(*)::int as n from public.state_legislators`)[0]!.n);
    expect(n).toBe(2);
    api.requests.length = 0;
    await findReps(
      sql,
      { census: census(), openstates: () => api.client() },
      '1100 Congress Ave, Austin, TX 78701',
      119,
    );
    expect(api.requests).toHaveLength(0);
    const cached = await sql`select key from public.geo_cache`;
    expect(cached[0]!.key).toMatch(/^people:30\.276,-97\.740$/);
  });

  it('falls back to district matching in the database without Open States', async () => {
    // TX legislators as the weekly people load stores them.
    for (const p of new FakeOpenStates().people.tx!) {
      await sql`
        insert into public.state_legislators (id, name, party, state, chamber, district, current)
        values (${p.id}, ${p.name}, ${p.party}, 'TX', ${p.chamber}, ${p.district}, true)`;
    }
    const result = await findReps(sql, { census: census() }, '1100 Congress Ave, Austin, TX 78701', 119);
    expect(result!.stateSource).toBe('database');
    expect(result!.stateLegislators.map((l) => l.name).sort()).toEqual(['Gina Hinojosa', 'Sarah Eckhardt']);
  });

  it('returns null for an address the Census cannot match', async () => {
    const none = new CensusGeocoder({
      fetch: async () => new Response(JSON.stringify({ result: { addressMatches: [] } })),
    });
    expect(await findReps(sql, { census: none }, 'nowhere at all', 119)).toBeNull();
  });
});
