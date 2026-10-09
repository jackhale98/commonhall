import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CourtListenerClient, type FetchLike } from '@civic/congress-client';
import { SCOTUS_JOB, runJob, syncSupremeCourt, type ScotusCursor, type Sql } from '@civic/sync';
import { asAnon } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const sample = readFileSync(
  fileURLToPath(
    new URL('../../packages/congress-client/test/fixtures/courtlistener/scotus-sample.json', import.meta.url),
  ),
  'utf8',
);

function fake() {
  const calls: URL[] = [];
  const fetch: FetchLike = async (input) => {
    calls.push(new URL(input));
    return new Response(sample, { headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

const run = (fetch: FetchLike) =>
  runJob<ScotusCursor>({
    sql,
    job: SCOTUS_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) =>
      syncSupremeCourt(ctx, {
        client: new CourtListenerClient({ token: 't', fetch }),
        now: () => new Date('2024-08-15T12:00:00Z'),
      }),
  });

beforeEach(async () => {
  await sql`delete from public.scotus_cases`;
  await sql`delete from public.sync_state where job = ${SCOTUS_JOB}`;
  await sql`delete from public.sync_lock`;
});

describe('sync-scotus', () => {
  it('loads five terms a month at a time, then re-reads only the last month', async () => {
    const api = fake();
    const first = await run(api.fetch);
    expect(first.status).toBe('ok');
    expect(first.rowsWritten).toBe(2);
    // October 2020 to August 2024: 47 months, each its own bounded query.
    expect(api.calls).toHaveLength(47);
    expect(api.calls[0]!.searchParams.get('q')).toContain('[2020-10-01 TO 2020-10-31]');
    expect(api.calls[46]!.searchParams.get('q')).toContain('[2024-08-01 TO 2024-08-31]');

    api.calls.length = 0;
    const second = await run(api.fetch);
    expect(second.rowsWritten).toBe(0);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.searchParams.get('q')).toContain('[2024-06-01 TO *]');
  });

  it('resumes the first load from the last finished month', async () => {
    await sql`insert into public.sync_state (job, cursor) values (${SCOTUS_JOB}, ${sql.json({ newest: '2024-07-01', filledThrough: '2024-06-30' })})`;
    const api = fake();
    await run(api.fetch);
    expect(api.calls.map((u) => u.searchParams.get('q')!.match(/\[(\S+) TO/)![1])).toEqual([
      '2024-07-01',
      '2024-08-01',
    ]);
  });

  it('is public to read', async () => {
    await run(fake().fetch);
    const rows = await asAnon(sql, (tx) => tx`select case_name from public.scotus_cases order by date_filed desc`);
    expect(rows.map((r) => r.case_name)).toEqual(['Trump v. United States', 'Loper Bright Enterprises v. Raimondo']);
  });
});
