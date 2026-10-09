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
    run: (ctx) => syncSupremeCourt(ctx, { client: new CourtListenerClient({ token: 't', fetch }) }),
  });

beforeEach(async () => {
  await sql`delete from public.scotus_cases`;
  await sql`delete from public.sync_state where job = ${SCOTUS_JOB}`;
  await sql`delete from public.sync_lock`;
});

describe('sync-scotus', () => {
  it('loads five terms, then re-reads only the last month', async () => {
    const api = fake();
    const first = await run(api.fetch);
    expect(first.status).toBe('ok');
    expect(first.rowsWritten).toBe(2);
    expect(api.calls[0]!.searchParams.get('q')).toContain('[2020-10-01 TO *]');

    const second = await run(api.fetch);
    expect(second.rowsWritten).toBe(0);
    expect(api.calls[1]!.searchParams.get('q')).toContain('[2024-06-01 TO *]');
  });

  it('is public to read', async () => {
    await run(fake().fetch);
    const rows = await asAnon(sql, (tx) => tx`select case_name from public.scotus_cases order by date_filed desc`);
    expect(rows.map((r) => r.case_name)).toEqual(['Trump v. United States', 'Loper Bright Enterprises v. Raimondo']);
  });
});
