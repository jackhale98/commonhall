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

  it('keeps each finished month when a run is cut off part-way', async () => {
    let calls = 0;
    const fetch: FetchLike = async () => {
      if (++calls >= 5) throw new Error('killed by the wall-clock limit');
      return new Response(sample, { headers: { 'content-type': 'application/json' } });
    };
    const result = await run(fetch);
    expect(result.status).toBe('error');
    const [state] = await sql`select cursor from public.sync_state where job = ${SCOTUS_JOB}`;
    // October 2020 to January 2021 finished before the fifth request failed.
    expect(state!.cursor.filledThrough).toBe('2021-01-31');
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

  it('drops a "Revisions" copy of a decision, whichever arrives first', async () => {
    const base = JSON.parse(sample) as { results: Record<string, unknown>[] };
    const original = base.results[0]!;
    const revision = { ...original, cluster_id: 99_000_001, caseName: `${original.caseName} Revisions: 7/01/24` };
    const serve = (results: unknown[]) => {
      const fetch: FetchLike = async () =>
        new Response(JSON.stringify({ count: results.length, next: null, results }), {
          headers: { 'content-type': 'application/json' },
        });
      return run(fetch);
    };
    // Revision first (alone), then the original: the revision gives way.
    await serve([revision]);
    expect((await sql`select case_name, revision from public.scotus_cases`)[0]).toEqual({
      case_name: 'Trump v. United States',
      revision: true,
    });
    await sql`delete from public.sync_state where job = ${SCOTUS_JOB}`;
    await serve([original, revision]);
    const rows = await sql`select cluster_id, case_name from public.scotus_cases order by cluster_id`;
    expect(rows).toEqual([{ cluster_id: String(original.cluster_id), case_name: 'Trump v. United States' }]);
  });

  it('is public to read', async () => {
    await run(fake().fetch);
    const rows = await asAnon(sql, (tx) => tx`select case_name from public.scotus_cases order by date_filed desc`);
    expect(rows.map((r) => r.case_name)).toEqual(['Trump v. United States', 'Loper Bright Enterprises v. Raimondo']);
  });
});
