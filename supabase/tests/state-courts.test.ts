import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CourtListenerClient, type FetchLike } from '@civic/congress-client';
import { STATE_COURTS_JOB, runJob, syncStateCourts, type Sql, type StateCourtsCursor } from '@civic/sync';
import { asAnon } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const sample = readFileSync(
  fileURLToPath(
    new URL('../../packages/congress-client/test/fixtures/courtlistener/mass-sample.json', import.meta.url),
  ),
  'utf8',
);

const opinion = readFileSync(
  fileURLToPath(new URL('../../packages/sync/test/fixtures/opinions/sjc-sample.txt', import.meta.url)),
  'utf8',
);

/** CourtListener: search results from the sample; /opinions/{id}/ answers with a slip opinion's text. */
function fake() {
  const calls: URL[] = [];
  const opinionCalls: URL[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes('/opinions/')) {
      opinionCalls.push(url);
      return new Response(JSON.stringify({ id: 1, plain_text: opinion }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    calls.push(url);
    return new Response(sample, { headers: { 'content-type': 'application/json' } });
  };
  return { calls, opinionCalls, fetch };
}

const run = (fetch: FetchLike) =>
  runJob<StateCourtsCursor>({
    sql,
    job: STATE_COURTS_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) =>
      syncStateCourts(ctx, {
        client: new CourtListenerClient({ token: 't', fetch }),
        now: () => new Date('2024-08-15T12:00:00Z'),
        courts: [{ court: 'mass', state: 'MA', since: '2024-06-01' }],
      }),
  });

beforeEach(async () => {
  await sql`delete from public.state_court_cases`;
  await sql`delete from public.sync_state where job = ${STATE_COURTS_JOB}`;
  await sql`delete from public.sync_lock`;
});

describe('sync-state-courts', () => {
  it('loads a court a month at a time, then re-reads only the last month', async () => {
    const api = fake();
    const first = await run(api.fetch);
    expect(first.status).toBe('ok');
    // Two decisions, and what each is about from its opinion text.
    expect(first.rowsWritten).toBe(4);
    expect(api.opinionCalls).toHaveLength(2);
    expect(api.calls).toHaveLength(3);
    // Newest month first.
    expect(api.calls[0]!.searchParams.get('q')).toBe('court_id:mass AND dateFiled:[2024-08-01 TO 2024-08-31]');
    expect(api.calls[2]!.searchParams.get('q')).toBe('court_id:mass AND dateFiled:[2024-06-01 TO 2024-06-30]');

    api.calls.length = 0;
    const second = await run(api.fetch);
    expect(second.rowsWritten).toBe(0);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.searchParams.get('q')).toContain('[2024-07-03 TO *]');
  });

  it('finishes an older oldest-first load newest first, without re-reading its months', async () => {
    await sql`
      insert into public.sync_state (job, cursor)
      values (${STATE_COURTS_JOB}, ${sql.json({ courts: { mass: { filledThrough: '2024-06-30' } } })})`;
    const api = fake();
    await run(api.fetch);
    expect(api.calls.map((u) => u.searchParams.get('q'))).toEqual([
      'court_id:mass AND dateFiled:[2024-08-01 TO 2024-08-31]',
      'court_id:mass AND dateFiled:[2024-07-01 TO 2024-07-31]',
    ]);
  });

  it('reads what each decision is about once', async () => {
    const api = fake();
    await run(api.fetch);
    const [row] = await sql`select keywords, opening from public.state_court_cases order by date_filed limit 1`;
    expect(row!.keywords).toMatch(/^Homicide\. Evidence, Prior misconduct, Hearsay\./);
    expect(row!.opening).toMatch(/^The defendant was convicted of murder in the first degree/);
    api.opinionCalls.length = 0;
    await run(api.fetch);
    expect(api.opinionCalls).toHaveLength(0);
  });

  it('is public to read', async () => {
    await run(fake().fetch);
    const rows = await asAnon(
      sql,
      (tx) => tx`select case_name, state, docket_number from public.state_court_cases order by date_filed`,
    );
    expect(rows).toEqual([
      { case_name: 'Commonwealth v. Example', state: 'MA', docket_number: 'SJC-13512' },
      { case_name: 'Doe v. Board of Registration', state: 'MA', docket_number: 'SJC-13600' },
    ]);
  });
});
