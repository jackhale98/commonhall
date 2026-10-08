import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LegislatorsClient } from '@civic/congress-client';
import {
  BILLS_JOB,
  getCursor,
  runBackfill,
  runJob,
  setCursor,
  syncBill,
  syncBillsIncremental,
  type BillsCursor,
  type BackfillCursor,
} from '@civic/sync';
import { connect } from './db.ts';
import { FakeCongress, fixtureJson, recordedHr1, syntheticBill } from './fake-congress.ts';

const sql = connect();
afterAll(() => sql.end());

async function resetFederal() {
  await sql`truncate public.bill_actions, public.bill_cosponsors, public.bill_subjects, public.bills, public.members cascade`;
  await sql`delete from public.sync_state`;
  await sql`delete from public.sync_lock`;
  await sql`delete from public.api_usage`;
}

beforeEach(resetFederal);

const quiet = () => undefined;

describe('syncBill', () => {
  it('loads a new bill with every sub-endpoint and derives its status', async () => {
    const api = new FakeCongress();
    api.addBill(recordedHr1());
    const client = api.client();

    const change = await syncBill(sql, client, 119, 'HR', 1);
    expect(change.isNew).toBe(true);
    expect(change.statusAfter).toBe('law');
    // detail, actions, subjects (239 fit in one page), summaries, text, titles
    expect(change.requests).toBe(6);

    const [bill] = await sql`select * from public.bills where id = '119-hr-1'`;
    expect(bill).toMatchObject({
      congress: 119,
      bill_type: 'hr',
      number: 1,
      origin_chamber: 'house',
      status: 'law',
      short_title: 'One Big Beautiful Bill Act',
      sponsor_id: 'A000375',
      policy_area: 'Economics and Public Finance',
      law_number: '119-21',
      latest_action_text: 'Became Public Law No: 119-21.',
      text_url: 'https://www.congress.gov/119/bills/hr1/BILLS-119hr1enr.htm',
      actions_count: 59,
      subjects_count: 240,
    });
    expect(bill!.summary_text).toBe(
      'One Big Beautiful Bill Act\n\nThis act provides for reconciliation.\n• Tax\n• Health',
    );

    const actions = (await sql`select count(*)::int as n from public.bill_actions where bill_id = '119-hr-1'`)[0]!.n;
    expect(actions).toBe(59);
    const [first] = await sql`select * from public.bill_actions where bill_id = '119-hr-1' and seq = 1`;
    // H.R. 1 began as an original measure reported by the Budget Committee.
    expect(first!.text).toMatch(/reported an original measure/);
    const subjects = (await sql`select count(*)::int as n from public.bill_subjects where bill_id = '119-hr-1'`)[0]!.n;
    expect(subjects).toBe(239);

    // The sponsor did not exist yet, so a stub member was created.
    const [sponsor] = await sql`select name, party, state, current from public.members where bioguide_id = 'A000375'`;
    expect(sponsor).toMatchObject({ name: 'Jodey Arrington', party: 'R', state: 'TX', current: false });
  });

  it('re-syncing an unchanged bill costs one request and writes nothing', async () => {
    const api = new FakeCongress();
    api.addBill(recordedHr1());
    const client = api.client();
    await syncBill(sql, client, 119, 'hr', 1);

    const again = await syncBill(sql, client, 119, 'hr', 1);
    expect(again.requests).toBe(1);
    expect(again.rowsWritten).toBe(0);
    expect(again.billChanged).toBe(false);
  });

  it('fetches only the sub-endpoints whose counts changed', async () => {
    const api = new FakeCongress();
    const bill = api.addBill(syntheticBill(42, '2026-10-01T12:00:00Z'));
    const client = api.client();
    await syncBill(sql, client, 119, 'hr', 42);

    bill.actions.unshift({
      actionCode: 'H30000',
      actionDate: '2026-10-05',
      sourceSystem: { code: 2, name: 'House floor actions' },
      text: 'Passed/agreed to in House: On passage Passed by voice vote.',
      type: 'Floor',
    });
    bill.cosponsors.push({
      bioguideId: 'B001328',
      firstName: 'Everton',
      lastName: 'Blair',
      party: 'D',
      state: 'GA',
      district: 13,
      sponsorshipDate: '2026-10-04',
      isOriginalCosponsor: false,
    });
    bill.updateDate = '2026-10-05T15:00:00Z';

    api.requests.length = 0;
    const change = await syncBill(sql, client, 119, 'hr', 42);
    expect(api.requests.map((u) => u.pathname)).toEqual([
      '/v3/bill/119/hr/42',
      '/v3/bill/119/hr/42/actions',
      '/v3/bill/119/hr/42/cosponsors',
    ]);
    expect(change.newActions.map((a) => a.text)).toEqual([
      'Passed/agreed to in House: On passage Passed by voice vote.',
    ]);
    expect(change.newCosponsors.map((c) => c.member_id)).toEqual(['B001328']);
    expect(change.statusBefore).toBe('in_committee');
    expect(change.statusAfter).toBe('passed_house');

    const [row] = await sql`select status, cosponsors_count, actions_count from public.bills where id = '119-hr-42'`;
    expect(row).toMatchObject({ status: 'passed_house', cosponsors_count: 1, actions_count: 3 });
  });

  it('removes withdrawn subjects and cosponsors that disappear upstream', async () => {
    const api = new FakeCongress();
    const bill = api.addBill(
      syntheticBill(7, '2026-10-01T00:00:00Z', {
        subjects: ['Taxation', 'Health'],
        cosponsors: [
          {
            bioguideId: 'B001328',
            firstName: 'Everton',
            lastName: 'Blair',
            party: 'D',
            state: 'GA',
            sponsorshipDate: '2026-10-02',
          },
        ],
      }),
    );
    const client = api.client();
    await syncBill(sql, client, 119, 'hr', 7);
    bill.subjects = ['Taxation'];
    bill.cosponsors = [];
    await syncBill(sql, client, 119, 'hr', 7);
    const subjects = await sql`select subject from public.bill_subjects where bill_id = '119-hr-7'`;
    expect(subjects.map((s) => s.subject)).toEqual(['Taxation']);
    const cos = await sql`select * from public.bill_cosponsors where bill_id = '119-hr-7'`;
    expect(cos).toHaveLength(0);
  });
});

describe('syncBillsIncremental', () => {
  async function run(api: FakeCongress, budget = Number.POSITIVE_INFINITY, concurrency = 1, timeLimitMs = 60_000) {
    const client = api.client(budget);
    return runJob<BillsCursor>({
      sql,
      job: BILLS_JOB,
      timeLimitMs,
      budgets: { congress: client.budget },
      log: quiet,
      run: async (ctx) => (await syncBillsIncremental(ctx, { congress: 119, client, concurrency })).cursor,
    });
  }

  it('does nothing until the backfill has set a starting point', async () => {
    const api = new FakeCongress();
    api.addBill(syntheticBill(1, '2026-10-01T00:00:00Z'));
    const result = await run(api);
    expect(result.status).toBe('ok');
    expect(result.rowsWritten).toBe(0);
    expect(api.requests).toHaveLength(0);
  });

  it('picks up changed bills and then writes zero rows on two quiet runs', async () => {
    const api = new FakeCongress();
    api.addBill(syntheticBill(1, '2026-10-06T10:00:00Z'));
    api.addBill(syntheticBill(2, '2026-10-06T11:00:00Z'));
    api.addBill(syntheticBill(3, '2026-09-01T00:00:00Z')); // before the cursor: ignored
    await setCursor(sql, BILLS_JOB, { since: '2026-10-06T00:00:00Z' });

    const first = await run(api);
    expect(first.status).toBe('ok');
    expect(first.rowsWritten).toBeGreaterThan(0);
    const ids = await sql`select id from public.bills order by id`;
    expect(ids.map((r) => r.id)).toEqual(['119-hr-1', '119-hr-2']);

    const cursor = await getCursor<BillsCursor>(sql, BILLS_JOB);
    expect(cursor.window).toBeUndefined();
    expect(cursor.since! > '2026-10-06T11:00:00Z').toBe(true);

    const second = await run(api);
    const third = await run(api);
    expect(second.rowsWritten).toBe(0);
    expect(third.rowsWritten).toBe(0);

    const [state] =
      await sql`select requests_used, rows_written, last_success_at from public.sync_state where job = ${BILLS_JOB}`;
    expect(state).toMatchObject({ rows_written: 0 });
    expect(state!.last_success_at).not.toBeNull();
  });

  it('stops at the request budget and resumes from the stored window', async () => {
    const api = new FakeCongress();
    for (let n = 1; n <= 30; n++) {
      api.addBill(syntheticBill(n, `2026-10-06T10:${String(n).padStart(2, '0')}:00Z`));
    }
    await setCursor(sql, BILLS_JOB, { since: '2026-10-06T00:00:00Z' });

    // Each new bill costs 3 requests (detail, actions, subjects) plus 1 for the list page.
    const first = await run(api, 1 + 7 * 3);
    expect(first.status).toBe('ok');
    const cursor = await getCursor<BillsCursor>(sql, BILLS_JOB);
    expect(cursor.window).toBeDefined();
    expect(cursor.window!.done).toHaveLength(7);
    const afterFirst = (await sql`select count(*)::int as n from public.bills`)[0]!.n;
    expect(afterFirst).toBe(7);

    // Between runs, two already-processed bills are updated again and leave the
    // window; with offset-based resumption the bills behind them would be skipped.
    api.bills.get('119-hr-2')!.updateDate = '2026-10-08T01:00:00Z';
    api.bills.get('119-hr-3')!.updateDate = '2026-10-08T01:00:00Z';
    for (let i = 0; i < 10; i++) {
      const c = await getCursor<BillsCursor>(sql, BILLS_JOB);
      if (!c.window) break;
      await run(api, 25, 3); // resumed runs sync three bills at a time
    }
    const total = (await sql`select count(*)::int as n from public.bills`)[0]!.n;
    expect(total).toBe(30);
    expect((await getCursor<BillsCursor>(sql, BILLS_JOB)).window).toBeUndefined();

    // Requests were charged to the shared hourly counter.
    const [usage] = await sql`select sum(requests)::int as n from public.api_usage where api = 'congress'`;
    expect(usage!.n).toBeGreaterThan(60);
  });

  it('refuses to start when another run holds the lease', async () => {
    const api = new FakeCongress();
    await setCursor(sql, BILLS_JOB, { since: '2026-10-06T00:00:00Z' });
    await sql`select public.try_sync_lock(${BILLS_JOB}, 'someone-else', '10 minutes')`;
    const result = await run(api);
    expect(result.status).toBe('skipped');
  });

  it('records errors in sync_state and leaves the cursor resumable', async () => {
    const api = new FakeCongress();
    api.addBill(syntheticBill(1, '2026-10-06T10:00:00Z'));
    await setCursor(sql, BILLS_JOB, { since: '2026-10-06T00:00:00Z' });
    const broken = api.fetch;
    api.fetch = async (input, init) => {
      if (String(input).includes('/actions')) return new Response('boom', { status: 400 });
      return broken(input, init);
    };
    // A 400 on a sub-endpoint is a client error: the bill is skipped, not retried forever.
    const result = await run(api);
    expect(result.status).toBe('ok');
    api.fetch = async () => new Response('down', { status: 503 });
    await setCursor(sql, BILLS_JOB, { since: '2026-10-06T00:00:00Z' });
    const failed = await run(api);
    expect(failed.status).toBe('error');
    const [state] = await sql`select last_error from public.sync_state where job = ${BILLS_JOB}`;
    expect(state!.last_error).toMatch(/HTTP 503/);
  });
});

describe('runBackfill', () => {
  it('loads members, then every bill number per type, then hands off to the hourly sync', async () => {
    const api = new FakeCongress();
    const members = fixtureJson('congress/members-list.json').members;
    for (const m of members) {
      api.members.set(m.bioguideId, {
        bioguideId: m.bioguideId,
        name: m.name,
        partyName: m.partyName,
        state: m.state,
        district: m.district,
        chamber: 'House of Representatives',
        current: true,
        imageUrl: m.depiction?.imageUrl,
        updateDate: m.updateDate,
      });
    }
    api.addBill(syntheticBill(1, '2026-10-01T00:00:00Z'));
    api.addBill(syntheticBill(3, '2026-10-01T00:00:00Z')); // number 2 is a gap (404)
    api.addBill(syntheticBill(1, '2026-10-01T00:00:00Z', { type: 'S', originChamber: 'Senate' }));

    const legislators = new LegislatorsClient({
      fetch: async (url) =>
        new Response(
          JSON.stringify(String(url).includes('social') ? [] : fixtureJson('legislators/legislators-current.json')),
        ),
    });

    let result;
    for (let i = 0; i < 5; i++) {
      const client = api.client();
      result = await runJob<BackfillCursor>({
        sql,
        job: 'backfill-federal',
        timeLimitMs: 60_000,
        budgets: { congress: client.budget },
        log: quiet,
        run: (ctx) =>
          runBackfill(ctx, { congress: 119, client, legislators, now: () => new Date('2026-10-08T00:00:00Z') }),
      });
      if (result.cursor?.step === 'done') break;
    }
    expect(result!.status).toBe('ok');
    expect(result!.cursor).toMatchObject({ step: 'done', billsDone: 4 });

    const bills = await sql`select id from public.bills order by id`;
    expect(bills.map((b) => b.id)).toEqual(['119-hr-1', '119-hr-3', '119-s-1']);
    const current = (await sql`select count(*)::int as n from public.members where current`)[0]!.n;
    expect(current).toBe(3);
    const [wahab] =
      await sql`select name, state, district, party, chamber from public.members where bioguide_id = 'W000832'`;
    expect(wahab).toMatchObject({ name: 'Aisha Wahab', state: 'CA', district: 14, party: 'D', chamber: 'house' });

    const hourly = await getCursor<BillsCursor>(sql, BILLS_JOB);
    expect(hourly.since).toBe('2026-10-07T23:55:00Z');
  });
});
