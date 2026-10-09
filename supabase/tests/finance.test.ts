import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FecClient, RequestBudget, type FetchLike } from '@civic/congress-client';
import { FINANCE_JOB, runJob, syncFinance, type FinanceCursor, type Sql } from '@civic/sync';
import { asAnon } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../packages/congress-client/test/fixtures/fec/${name}`, import.meta.url)),
    'utf8',
  );

/** Fake OpenFEC: Warren's recorded responses for S2MA00170, nothing for anyone else. */
function fakeFec() {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url.pathname);
    const known =
      url.pathname.includes('S2MA00170') ||
      url.searchParams.get('candidate_id') === 'S2MA00170' ||
      url.searchParams.get('committee_id') === 'C00500843';
    const empty = JSON.stringify({ pagination: { count: 0, pages: 0, per_page: 20 }, results: [] });
    const file = url.pathname.endsWith('/totals/')
      ? 'totals-warren.json'
      : url.pathname.endsWith('/committees/')
        ? 'committees-warren.json'
        : url.pathname.endsWith('/by_employer/')
          ? 'employer-warren.json'
          : url.pathname.endsWith('/by_size/by_candidate/')
            ? 'size-sample.json'
            : url.pathname.endsWith('/by_state/by_candidate/')
              ? 'state-sample.json'
              : 'committee-receipts-sample.json';
    return new Response(known ? fixture(file) : empty, { headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

async function run(fetch: FetchLike, cap = 100) {
  return runJob<FinanceCursor>({
    sql,
    job: FINANCE_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) =>
      syncFinance(ctx, { client: new FecClient({ apiKey: 'test', fetch, budget: new RequestBudget(cap, 'fec') }) }),
  });
}

beforeEach(async () => {
  await sql`delete from public.member_finance`;
  await sql`delete from public.sync_state where job = ${FINANCE_JOB}`;
  await sql`delete from public.sync_lock`;
  await sql`update public.members set fec_candidate_id = null, next_election = null`;
  await sql`insert into public.members (bioguide_id, name, state, chamber, current, fec_candidate_id, next_election)
            values ('W000817', 'Elizabeth Warren', 'MA', 'senate', true, 'S2MA00170', 2030),
                   ('Z999999', 'Pat Example', 'MA', 'house', true, 'H6MA99999', 2026)
            on conflict (bioguide_id) do update set current = true, fec_candidate_id = excluded.fec_candidate_id,
              next_election = excluded.next_election, state = excluded.state`;
});

describe('sync-finance', () => {
  it('refreshes due members, records empty rows, and is quiet on a re-run within the week', async () => {
    const fec = fakeFec();
    const first = await run(fec.fetch);
    expect(first.status).toBe('ok');
    const rows =
      await sql`select member_id, receipts, pacs, top_employers, top_committees from public.member_finance order by member_id`;
    expect(rows.map((r) => r.member_id)).toEqual(['W000817', 'Z999999']);
    expect(Number(rows[0]!.receipts)).toBe(4413931.4);
    expect(rows[0]!.top_committees[0]).toMatchObject({ name: 'EXAMPLE NURSES PAC', total: 7500 });
    // Nothing on file for the second candidate: an empty row so it is not retried every hour.
    expect(rows[1]!.receipts).toBeNull();

    const callsBefore = fec.calls.length;
    const second = await run(fec.fetch);
    expect(second.rowsWritten).toBe(0);
    expect(fec.calls.length).toBe(callsBefore);
  });

  it('stops before the hourly budget runs out', async () => {
    const fec = fakeFec();
    await run(fec.fetch, 8); // room for one member (6 requests), not two
    expect(await sql`select member_id from public.member_finance`).toHaveLength(1);
  });

  it('is public to read', async () => {
    await run(fakeFec().fetch);
    const rows = await asAnon(sql, (tx) => tx`select member_id from public.member_finance where member_id = 'W000817'`);
    expect(rows).toHaveLength(1);
  });
});
