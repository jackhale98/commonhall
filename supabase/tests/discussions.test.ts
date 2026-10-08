import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '@civic/sync';
import { asAnon, asUser, createUser } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const discussion = (id: string, status = 'open', extra: Record<string, unknown> = {}) => ({
  id,
  title: `Test ${id}`,
  prompt: 'A neutral question for testing.',
  jurisdiction: 'federal',
  status,
  ...extra,
});

beforeEach(async () => {
  await sql`delete from public.discussions where id like 'test-%'`;
  await sql`delete from public.feed_events where dedupe_key like 'discussion_opened:test-%'`;
  await sql`delete from auth.users where email like '%@example.test'`;
});

describe('discussions', () => {
  it('shows published discussions to everyone and drafts only to admins', async () => {
    await sql`insert into public.discussions ${sql([discussion('test-open'), discussion('test-draft', 'draft')] as never)}`;
    const anon = await asAnon(sql, (tx) => tx`select id from public.discussions where id like 'test-%' order by id`);
    expect(anon.map((r) => r.id)).toEqual(['test-open']);

    const admin = await createUser(sql);
    await sql`insert into public.admins (user_id, role) values (${admin}, 'moderator')`;
    const seen = await asUser(
      sql,
      admin,
      (tx) => tx`select id from public.discussions where id like 'test-%' order by id`,
    );
    expect(seen.map((r) => r.id)).toEqual(['test-draft', 'test-open']);
  });

  it('lets only admins create and edit discussions', async () => {
    const user = await createUser(sql);
    const denied = await asUser(
      sql,
      user,
      (tx) => tx`insert into public.discussions ${tx(discussion('test-nope') as never)}`,
    ).catch((e: Error) => e);
    expect(String(denied)).toMatch(/row-level security/);
    // Users cannot make themselves admins.
    const self = await asUser(sql, user, (tx) => tx`insert into public.admins (user_id) values (${user})`).catch(
      (e: Error) => e,
    );
    expect(String(self)).toMatch(/permission denied/);

    const admin = await createUser(sql);
    await sql`insert into public.admins (user_id) values (${admin})`;
    await asUser(
      sql,
      admin,
      (tx) => tx`insert into public.discussions ${tx(discussion('test-new', 'draft') as never)}`,
    );
    await asUser(sql, admin, (tx) => tx`update public.discussions set status = 'open' where id = 'test-new'`);
    const [row] = await sql`select created_by, status from public.discussions where id = 'test-new'`;
    expect(row).toMatchObject({ created_by: admin, status: 'open' });
  });

  it('tells followers of the linked bill when a discussion opens, once', async () => {
    const user = await createUser(sql);
    await sql`insert into public.follows (user_id, target_type, target_id) values (${user}, 'bill', '119-hr-1')`;
    await sql`insert into public.discussions ${sql(discussion('test-hr1', 'draft', { target_type: 'bill', target_id: '119-hr-1' }) as never)}`;
    await sql`update public.discussions set status = 'open' where id = 'test-hr1'`;
    await sql`update public.discussions set status = 'closed' where id = 'test-hr1'`;
    await sql`update public.discussions set status = 'open' where id = 'test-hr1'`;
    const feed = await asUser(
      sql,
      user,
      (tx) =>
        tx`select kind, payload from public.feed where kind = 'discussion_opened' and payload->>'discussion_id' = 'test-hr1'`,
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]!.payload).toMatchObject({ discussion_id: 'test-hr1' });
  });

  it('keeps requests private but publishes their count', async () => {
    const [a, b, admin] = [await createUser(sql), await createUser(sql), await createUser(sql)];
    await sql`insert into public.admins (user_id) values (${admin})`;
    for (const u of [a, b]) {
      await asUser(
        sql,
        u,
        (tx) =>
          tx`insert into public.discussion_requests (user_id, target_type, target_id) values (${u}, 'bill', '119-hr-1')`,
      );
    }
    const mine = await asUser(sql, a, (tx) => tx`select user_id from public.discussion_requests`);
    expect(mine.map((r) => r.user_id)).toEqual([a]);
    const forged = await asUser(
      sql,
      a,
      (tx) =>
        tx`insert into public.discussion_requests (user_id, target_type, target_id) values (${b}, 'bill', '119-hr-2')`,
    ).catch((e: Error) => e);
    expect(String(forged)).toMatch(/row-level security/);

    const [count] = await asAnon(sql, (tx) => tx`select public.discussion_request_count('bill', '119-hr-1') as n`);
    expect(count!.n).toBe(2);
    const anonRead = await asAnon(sql, (tx) => tx`select * from public.discussion_requests`).catch((e: Error) => e);
    expect(String(anonRead)).toMatch(/permission denied/);

    const summaryForUser = await asUser(sql, a, (tx) => tx`select * from public.discussion_request_summary()`);
    expect(summaryForUser).toHaveLength(0);
    const summary = await asUser(sql, admin, (tx) => tx`select * from public.discussion_request_summary()`);
    expect(summary.find((r) => r.target_id === '119-hr-1')).toMatchObject({ requests: 2 });
  });

  it('gives each profile a random Pol.is id that is not the user id', async () => {
    const [a, b] = [await createUser(sql), await createUser(sql)];
    for (const u of [a, b]) await asUser(sql, u, (tx) => tx`insert into public.profiles (user_id) values (${u})`);
    const rows = await sql`select user_id, polis_xid from public.profiles where user_id in (${a}, ${b})`;
    expect(new Set(rows.map((r) => r.polis_xid)).size).toBe(2);
    for (const r of rows) expect(r.polis_xid).not.toBe(r.user_id);
    // Another user cannot read it.
    const other = await asUser(sql, a, (tx) => tx`select polis_xid from public.profiles where user_id = ${b}`);
    expect(other).toHaveLength(0);
  });
});

describe('prerender views', () => {
  it('include advanced, discussed and followed items and expose ids only', async () => {
    const user = await createUser(sql);
    const bill = (n: number, status: string, title: string) => ({
      id: `119-hr-${n}`,
      congress: 119,
      bill_type: 'hr',
      number: n,
      title,
      status,
    });
    await sql`delete from public.bills where id in ('119-hr-99001', '119-hr-99002', '119-hr-99003', '119-hr-99004')`;
    await sql`insert into public.bills ${sql([
      bill(99001, 'passed_house', 'Advanced bill'),
      bill(99002, 'introduced', 'Discussed bill'),
      bill(99003, 'introduced', 'Followed bill'),
      bill(99004, 'introduced', 'Quiet bill'),
    ] as never)}`;
    await sql`insert into public.discussions ${sql(discussion('test-pr', 'open', { target_type: 'bill', target_id: '119-hr-99002' }) as never)}`;
    await sql`insert into public.follows (user_id, target_type, target_id) values (${user}, 'bill', '119-hr-99003')`;
    await sql`insert into public.local_matters (id, city, matter_id, title) values ('boston-1', 'boston', 1, 'Test matter'),
      ('boston-2', 'boston', 2, 'Quiet matter') on conflict do nothing`;
    await sql`insert into public.follows (user_id, target_type, target_id) values (${user}, 'local_matter', 'boston-1')`;

    const bills = await asAnon(
      sql,
      (tx) => tx`select * from public.bills_prerender where id like '119-hr-9900%' order by id`,
    );
    expect(bills).toEqual([
      { id: '119-hr-99001', congress: 119 },
      { id: '119-hr-99002', congress: 119 },
      { id: '119-hr-99003', congress: 119 },
    ]);
    const matters = await asAnon(
      sql,
      (tx) => tx`select id from public.local_matters_prerender where id like 'boston-_'`,
    );
    expect(matters.map((r) => r.id)).toEqual(['boston-1']);

    await sql`delete from public.bills where id like '119-hr-9900%'`;
    await sql`delete from public.local_matters where id in ('boston-1', 'boston-2')`;
  });
});
