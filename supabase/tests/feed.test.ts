import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BILLS_JOB,
  billEvents,
  runJob,
  setCursor,
  syncBillsIncremental,
  writeFeedEvents,
  type BillsCursor,
  type Sql,
} from '@civic/sync';
import { asAnon, asUser, createUser } from './auth.ts';
import { connect } from './db.ts';
import { FakeCongress, syntheticBill } from './fake-congress.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

beforeEach(async () => {
  await sql`truncate public.feed_events, public.follows, public.feed_reads, public.profiles`;
  await sql`truncate public.bill_actions, public.bill_cosponsors, public.bill_subjects, public.bills, public.members cascade`;
  await sql`delete from public.sync_state`;
  await sql`delete from public.sync_lock`;
  await sql`delete from auth.users where email like '%@example.test'`;
});

async function hourlySync(api: FakeCongress) {
  const client = api.client();
  return runJob<BillsCursor>({
    sql,
    job: BILLS_JOB,
    timeLimitMs: 60_000,
    budgets: { congress: client.budget },
    log: () => undefined,
    run: async (ctx) =>
      (
        await syncBillsIncremental(ctx, {
          congress: 119,
          client,
          onChange: (change) => writeFeedEvents(sql, billEvents(change)),
        })
      ).cursor,
  });
}

describe('feed', () => {
  it('shows the next action on a followed bill after the following sync', async () => {
    const api = new FakeCongress();
    const bill = api.addBill(syntheticBill(77, '2026-10-06T10:00:00Z'));
    await setCursor(sql, BILLS_JOB, { since: '2026-10-06T00:00:00Z' });
    await hourlySync(api);

    const alice = await createUser(sql);
    await asUser(
      sql,
      alice,
      (tx) => tx`insert into public.follows (user_id, target_type, target_id) values (${alice}, 'bill', '119-hr-77')`,
    );
    await asUser(
      sql,
      alice,
      (tx) => tx`insert into public.feed_reads (user_id, last_seen_at) values (${alice}, now())`,
    );

    // Upstream: the bill passes the House (chamber action plus the LoC copy).
    bill.actions.unshift(
      {
        actionCode: '8000',
        actionDate: '2026-10-07',
        sourceSystem: { code: 9, name: 'Library of Congress' },
        text: 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 230 - 190.',
        type: 'Floor',
      },
      {
        actionCode: 'H37300',
        actionDate: '2026-10-07',
        sourceSystem: { code: 2, name: 'House floor actions' },
        text: 'On passage Passed by the Yeas and Nays: 230 - 190.',
        type: 'Floor',
      },
    );
    bill.updateDate = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    await hourlySync(api);

    const feed = await asUser(
      sql,
      alice,
      (tx) => tx`select kind, summary, unread, payload from public.feed order by occurred_at desc, id desc`,
    );
    // The bill's introduction (recorded before Alice followed it, so already read) and
    // one event for the House passage: its chamber and LoC copies became one event.
    expect(feed.map((f) => [f.kind, f.unread])).toEqual([
      ['action', true],
      ['new_bill', false],
    ]);
    expect(feed[0]!.summary).toMatch(/^H\.R\. 77: .*Passed by the Yeas and Nays/);
    expect(feed[0]!.payload).toMatchObject({ status: 'passed_house', status_changed: true });

    // Marking read clears the unread flag.
    await asUser(
      sql,
      alice,
      (tx) => tx`update public.feed_reads set last_seen_at = now() + interval '1 second' where user_id = ${alice}`,
    );
    const [count] = await asUser(sql, alice, (tx) => tx`select public.feed_unread_count() as n`);
    expect(count!.n).toBe(0);

    // Rerunning the same window writes no duplicate events.
    await setCursor(sql, BILLS_JOB, { since: '2026-10-06T00:00:00Z' });
    await hourlySync(api);
    const [row] = await sql`select count(*)::int as n from public.feed_events where kind = 'action'`;
    const n = row!.n;
    expect(n).toBe(1);
  });

  it('shows activity of followed legislators: new bills they sponsor and bills they cosponsor', async () => {
    const api = new FakeCongress();
    await setCursor(sql, BILLS_JOB, { since: '2026-10-06T00:00:00Z' });
    api.addBill(syntheticBill(1, '2026-10-06T10:00:00Z'));
    await hourlySync(api); // first sight of bill 1 (no feed yet: nobody follows)

    const bob = await createUser(sql);
    await asUser(
      sql,
      bob,
      (tx) =>
        tx`insert into public.follows (user_id, target_type, target_id) values (${bob}, 'member', 'A000375'), (${bob}, 'member', 'B001328')`,
    );

    api.addBill(syntheticBill(2, new Date().toISOString().replace(/\.\d+Z$/, 'Z')));
    api.bills.get('119-hr-1')!.cosponsors.push({
      bioguideId: 'B001328',
      firstName: 'Everton',
      lastName: 'Blair',
      party: 'D',
      state: 'GA',
      sponsorshipDate: '2026-10-07',
    });
    api.bills.get('119-hr-1')!.updateDate = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    await hourlySync(api);

    const feed = await asUser(
      sql,
      bob,
      (tx) => tx`select kind, target_id, member_id, reason from public.feed order by kind`,
    );
    expect(feed.map((f) => [f.kind, f.target_id, f.member_id, f.reason])).toEqual([
      ['cosponsor', '119-hr-1', 'B001328', 'legislator'],
      ['new_bill', '119-hr-1', 'A000375', 'legislator'],
      ['new_bill', '119-hr-2', 'A000375', 'legislator'],
    ]);
  });
});

describe('row-level security for user data', () => {
  it('stops one user reading or changing another user’s follows, profile and feed', async () => {
    const alice = await createUser(sql);
    const mallory = await createUser(sql);
    await asUser(sql, alice, async (tx) => {
      await tx`insert into public.follows (user_id, target_type, target_id) values (${alice}, 'bill', '119-hr-1')`;
      await tx`insert into public.profiles (user_id, address_label, state) values (${alice}, '1 Main St', 'TX')`;
    });
    await writeFeedEvents(sql, [
      {
        target_type: 'bill',
        target_id: '119-hr-1',
        kind: 'action',
        member_type: null,
        member_id: null,
        occurred_at: new Date().toISOString(),
        summary: 'x',
        payload: {},
        dedupe_key: 'rls-test',
      },
    ]);

    const seen = await asUser(sql, mallory, async (tx) => ({
      follows: await tx`select * from public.follows`,
      profiles: await tx`select * from public.profiles`,
      feed: await tx`select * from public.feed`,
      filtered: await tx`select * from public.follows where user_id = ${alice}`,
    }));
    expect(seen).toEqual({ follows: [], profiles: [], feed: [], filtered: [] });

    // Writes on Alice's behalf are rejected or affect nothing.
    const insert = await asUser(
      sql,
      mallory,
      (tx) => tx`insert into public.follows (user_id, target_type, target_id) values (${alice}, 'bill', '119-hr-2')`,
    ).catch((e: Error) => e);
    expect(String(insert)).toMatch(/row-level security/);
    const deleted = await asUser(
      sql,
      mallory,
      (tx) => tx`delete from public.follows where user_id = ${alice} returning 1`,
    );
    expect(deleted).toHaveLength(0);
    const updated = await asUser(
      sql,
      mallory,
      (tx) => tx`update public.profiles set address_label = 'pwned' returning 1`,
    );
    expect(updated).toHaveLength(0);

    // Alice still sees her own data and feed.
    const own = await asUser(sql, alice, async (tx) => ({
      follows: (await tx`select target_id from public.follows`).map((r) => r.target_id),
      feed: (await tx`select summary from public.feed`).length,
    }));
    expect(own).toEqual({ follows: ['119-hr-1'], feed: 1 });

    // Anonymous visitors see none of it, but can read public feed events.
    const anonFollows = await asAnon(sql, (tx) => tx`select * from public.follows`).catch((e: Error) => e);
    expect(String(anonFollows)).toMatch(/permission denied/);
    const anonFeed = await asAnon(sql, (tx) => tx`select * from public.feed`).catch((e: Error) => e);
    expect(String(anonFeed)).toMatch(/permission denied/);
    const events = await asAnon(sql, (tx) => tx`select * from public.feed_events`);
    expect(events).toHaveLength(1);
  });

  it('cannot write feed events as a user', async () => {
    const alice = await createUser(sql);
    const error = await asUser(
      sql,
      alice,
      (tx) =>
        tx`insert into public.feed_events (target_type, target_id, kind, occurred_at, summary, dedupe_key) values ('bill','x','action',now(),'spam','spam')`,
    ).catch((e: Error) => e);
    expect(String(error)).toMatch(/permission denied/);
  });

  it('deleting the auth user removes their data', async () => {
    const alice = await createUser(sql);
    await asUser(
      sql,
      alice,
      (tx) => tx`insert into public.follows (user_id, target_type, target_id) values (${alice}, 'bill', '119-hr-1')`,
    );
    await sql`delete from auth.users where id = ${alice}`;
    const rows = await sql`select * from public.follows where user_id = ${alice}`;
    expect(rows).toHaveLength(0);
  });
});
