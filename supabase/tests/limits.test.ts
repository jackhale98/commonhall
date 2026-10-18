import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clientIp, withinClientLimit, type Sql } from '@civic/sync';
import { asAnon, asUser, createUser } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());
beforeEach(async () => {
  await sql`delete from private.rate_limits`;
  await sql`delete from public.discussion_requests_anon`;
});

/** As an anonymous visitor whose request came from `ip`, the way PostgREST sets it. */
const fromIp = <T>(ip: string, fn: (tx: Sql) => Promise<T>) =>
  asAnon(sql, async (tx) => {
    await tx`select set_config('request.headers', ${JSON.stringify({ 'x-forwarded-for': `${ip}, 10.0.0.1` })}, true)`;
    return fn(tx);
  });

const ask = (tx: Sql, client: string, n: number) =>
  tx`select public.set_anonymous_discussion_request(${client}, 'bill', ${`119-hr-${n}`}, true)`;

describe('per-client limits', () => {
  it('counts hits per client and refuses past the limit, keeping no address', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await withinClientLimit(sql, 'test', '203.0.113.9', 3));
    expect(results).toEqual([true, true, true, false]);
    // Another client has its own count.
    expect(await withinClientLimit(sql, 'test', '203.0.113.10', 3)).toBe(true);
    const keys = await sql<{ client: string }[]>`select client from private.rate_limits where bucket = 'test'`;
    expect(keys.every((k) => /^[0-9a-f]{64}$/.test(k.client))).toBe(true);
  });

  it('reads the client address from the gateway headers', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.2' }))).toBe('198.51.100.7');
    expect(clientIp(new Headers({ 'cf-connecting-ip': '198.51.100.8', 'x-forwarded-for': '1.1.1.1' }))).toBe(
      '198.51.100.8',
    );
    expect(clientIp(new Headers())).toBeNull();
  });

  it('limits anonymous discussion requests per address, whatever browser id is sent', async () => {
    for (let n = 1; n <= 20; n++) await fromIp('203.0.113.20', (tx) => ask(tx, randomUUID(), n));
    await expect(fromIp('203.0.113.20', (tx) => ask(tx, randomUUID(), 21))).rejects.toThrow(
      /Too many requests from you/,
    );
    // Someone else is unaffected.
    await fromIp('203.0.113.21', (tx) => ask(tx, randomUUID(), 22));
    const [{ n }] = (await sql`select count(*)::int as n from public.discussion_requests_anon`) as unknown as [
      { n: number },
    ];
    expect(n).toBe(21);
  });

  it('limits anonymous discussion requests per browser id', async () => {
    const browser = randomUUID();
    for (let n = 1; n <= 20; n++) await fromIp(`203.0.113.${100 + n}`, (tx) => ask(tx, browser, n));
    await expect(fromIp('203.0.113.200', (tx) => ask(tx, browser, 21))).rejects.toThrow(/Too many requests from you/);
  });
});

describe('profiles', () => {
  it("doesn't let a user change the random id Pol.is sees", async () => {
    const user = await createUser(sql);
    await asUser(sql, user, (tx) => tx`insert into public.profiles (user_id, state) values (${user}, 'MA')`);
    await expect(
      asUser(sql, user, (tx) => tx`update public.profiles set polis_xid = gen_random_uuid() where user_id = ${user}`),
    ).rejects.toThrow(/permission denied/);
    // Their own address fields stay writable, as the site's upsert writes them.
    await asUser(
      sql,
      user,
      (tx) => tx`
        insert into public.profiles (user_id, state, city, council_district, updated_at)
        values (${user}, 'MA', 'ma-boston', 3, now())
        on conflict (user_id) do update set state = excluded.state, city = excluded.city,
          council_district = excluded.council_district, updated_at = excluded.updated_at, user_id = excluded.user_id`,
    );
    const [row] = await asUser(sql, user, (tx) => tx`select city, council_district from public.profiles`);
    expect(row).toEqual({ city: 'ma-boston', council_district: 3 });
  });

  it('caps signed-in discussion requests per user', async () => {
    const user = await createUser(sql);
    await sql`
      insert into public.discussion_requests (user_id, target_type, target_id)
      select ${user}, 'bill', '119-hr-' || g from generate_series(1, 300) g`;
    await expect(
      asUser(
        sql,
        user,
        (tx) =>
          tx`insert into public.discussion_requests (user_id, target_type, target_id) values (${user}, 'bill', '119-hr-301')`,
      ),
    ).rejects.toThrow(/at most 300 discussions/);
  });
});
