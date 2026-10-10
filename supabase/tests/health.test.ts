import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestBudget } from '@civic/congress-client';
import { hourlyBudget, jobBudgets, runJob } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect();
afterAll(() => sql.end());

beforeEach(async () => {
  await sql`delete from public.sync_state`;
  await sql`delete from public.sync_lock`;
  await sql`delete from public.api_usage`;
});

const problems = async () =>
  Object.fromEntries(
    (
      await sql<{ name: string; problem: string }[]>`select name, problem from private.sync_health() where kind = 'job'`
    ).map((r) => [r.name, r.problem]),
  );

describe('sync_health', () => {
  it('flags a failed run until a later run succeeds', async () => {
    const fail = await runJob({
      sql,
      job: 'boston-zba',
      timeLimitMs: 1000,
      log: () => undefined,
      run: async () => {
        throw new Error('column "decision" does not exist');
      },
    });
    expect(fail.status).toBe('error');
    expect((await problems())['boston-zba']).toBe('last run failed');

    await runJob({ sql, job: 'boston-zba', timeLimitMs: 1000, log: () => undefined, run: async (c) => c.cursor });
    expect((await problems())['boston-zba']).toBeUndefined();
  });

  it('flags overdue jobs and runs that died', async () => {
    await sql`
      insert into public.sync_state (job, last_started_at, last_success_at) values
        ('boston-311', now() - interval '4 days', now() - interval '4 days'),
        ('worcester', now() - interval '2 hours', now() - interval '3 hours')`;
    const p = await problems();
    expect(p['boston-311']).toBe('overdue');
    expect(p['worcester']).toBe('last run stopped without finishing');
  });

  it('flags a dataset with nothing new, and shows anon no error text', async () => {
    await sql`
      insert into public.sync_state (job, last_started_at, last_error, last_error_at)
      values ('state', now(), 'secret detail', now())`;
    const rows = await sql.begin(async (tx) => {
      await tx`set local role anon`;
      return tx<{ name: string; problem: string | null }[]>`select * from public.data_status()`;
    });
    expect(rows.find((r) => r.name === 'state')?.problem).toBe('last run failed');
    expect(JSON.stringify(rows)).not.toContain('secret detail');
  });

  it('gives a governor who issues few orders a longer quiet spell', async () => {
    await sql`delete from public.state_executive_orders where state in ('CT', 'ZZ')`;
    try {
      // Connecticut: a few orders a year, the newest eight months old.
      await sql`
        insert into public.state_executive_orders (state, number, label, title, url, signed_date) values
          ('CT', 202603, '26-3', 'A', 'https://example.test/1', current_date - 240),
          ('CT', 202501, '25-1', 'B', 'https://example.test/2', current_date - 600)`;
      // A busy governor (ten in two years) whose newest is as old.
      await sql`
        insert into public.state_executive_orders (state, number, label, title, url, signed_date)
        select 'ZZ', n, n::text, 'x', 'https://example.test/zz', current_date - 240 - n * 30
          from generate_series(0, 9) n`;
      const rows = await sql<{ name: string; problem: string | null; max_age: string }[]>`
        select h.name, h.problem, f.max_age::text
          from private.health_rows() h join private.data_freshness() f using (name)
         where h.name in ('governor:CT', 'governor:ZZ') order by h.name`;
      expect(rows).toEqual([
        { name: 'governor:CT', problem: null, max_age: '450 days' },
        { name: 'governor:ZZ', problem: expect.stringMatching(/^nothing new since/), max_age: '180 days' },
      ]);
    } finally {
      await sql`delete from public.state_executive_orders where state in ('CT', 'ZZ')`;
    }
  });
});

describe('daily shares', () => {
  it('holds a job to its share of a shared daily limit', async () => {
    await sql`select public.record_api_usage('courtlistener:scotus', 60)`;
    await sql`select public.record_api_usage('courtlistener', 30)`;
    expect((await hourlyBudget(sql, 'courtlistener', 10, 'scotus')).limit).toBe(0);
    expect((await hourlyBudget(sql, 'courtlistener', 8, 'state-courts')).limit).toBe(8);
  });

  it('charges a job under the API and its share', async () => {
    const budget = new RequestBudget(5, 'courtlistener');
    await runJob({
      sql,
      job: 'state-courts',
      timeLimitMs: 1000,
      log: () => undefined,
      budgets: jobBudgets('courtlistener', 'state-courts', budget),
      run: async (c) => {
        budget.take();
        budget.take();
        return c.cursor;
      },
    });
    const usage = await sql<
      { api: string; requests: number }[]
    >`select api, requests from public.api_usage order by api`;
    expect(usage).toEqual([
      { api: 'courtlistener', requests: 2 },
      { api: 'courtlistener:state-courts', requests: 2 },
    ]);
  });
});
