import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AnalyzeBostonClient, type FetchLike } from '@civic/congress-client';
import {
  CAPITAL_PLAN_JOB,
  ZBA_JOB,
  runJob,
  syncCapitalPlan,
  syncZoningAppeals,
  type CapitalPlanCursor,
  type Sql,
  type ZbaCursor,
} from '@civic/sync';
import { asAnon } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixtureJson = <T>(name: string): T =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../packages/congress-client/test/fixtures/analyze-boston/${name}`, import.meta.url)),
      'utf8',
    ),
  ) as T;

const ok = (result: unknown) =>
  new Response(JSON.stringify({ success: true, result }), { headers: { 'content-type': 'application/json' } });

/** Analyze Boston, served from recorded responses; `rows` and `modified` can be changed between runs. */
class FakeAnalyzeBoston {
  pkg = fixtureJson<{ result: { resources: { last_modified: string | null }[] } }>('capital-package.json').result;
  rows = fixtureJson<{ result: { records: Record<string, unknown>[] } }>('capital-rows.json').result.records;
  zba: Record<string, unknown>[] = [
    { boa_apno: 'BOA1', city: 'Dorchester', status: 'Hearing Scheduled', hearing_date: '2026-10-22', decision: null },
    { boa_apno: 'BOA2', city: 'Roxbury', status: 'Appeal Closed', hearing_date: '2026-03-01', decision: 'AppProv' },
    // A rescheduled hearing repeats the case number: the later row wins.
    { boa_apno: 'BOA2', city: 'Roxbury', status: 'Appeal Closed', hearing_date: '2026-04-01', decision: 'Approved' },
  ];
  sqlSeen: string[] = [];
  calls: URL[] = [];
  fetch: FetchLike = async (input) => {
    const url = new URL(input);
    this.calls.push(url);
    if (url.pathname.endsWith('/package_show')) return ok(this.pkg);
    if (url.pathname.endsWith('/datastore_search_sql')) {
      this.sqlSeen.push(url.searchParams.get('sql')!);
      return ok({ records: this.zba });
    }
    if (url.pathname.endsWith('/datastore_search')) {
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      return ok({ records: this.rows.slice(offset, offset + limit), total: this.rows.length });
    }
    return new Response('not found', { status: 404 });
  };
}

const runCapital = (api: FakeAnalyzeBoston) =>
  runJob<CapitalPlanCursor>({
    sql,
    job: CAPITAL_PLAN_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) => syncCapitalPlan(ctx, { client: new AnalyzeBostonClient({ fetch: api.fetch }) }),
  });

const runZba = (api: FakeAnalyzeBoston) =>
  runJob<ZbaCursor>({
    sql,
    job: ZBA_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) =>
      syncZoningAppeals(ctx, {
        client: new AnalyzeBostonClient({ fetch: api.fetch }),
        now: () => new Date('2026-10-09T12:00:00Z'),
      }),
  });

beforeEach(async () => {
  await sql`delete from public.capital_projects`;
  await sql`delete from public.zba_appeals`;
  await sql`delete from public.sync_state where job in (${CAPITAL_PLAN_JOB}, ${ZBA_JOB})`;
  await sql`delete from public.sync_lock`;
});

describe('sync-capital-plan', () => {
  it('loads the plan, skips an unchanged table and drops projects that leave the plan', async () => {
    const api = new FakeAnalyzeBoston();
    const first = await runCapital(api);
    expect(first.status).toBe('ok');
    const rows = await asAnon(
      sql,
      (tx) => tx`select proj_id, plan, first_year, total_budget from public.capital_projects`,
    );
    expect(rows).toHaveLength(api.rows.length);
    expect(rows[0]).toMatchObject({ plan: 'FY27-31', first_year: 2027 });

    // Same table on the portal: no rows read.
    api.calls.length = 0;
    expect((await runCapital(api)).rowsWritten).toBe(0);
    expect(api.calls.some((u) => u.pathname.endsWith('/datastore_search'))).toBe(false);

    // A new upload without one project.
    api.pkg.resources[0]!.last_modified = '2027-08-01T00:00:00';
    api.rows = api.rows.slice(1);
    const third = await runCapital(api);
    expect(third.rowsWritten).toBe(1);
    expect(await sql`select proj_id from public.capital_projects`).toHaveLength(api.rows.length);
  });

  it('keeps the stored plan when the table comes back empty', async () => {
    const api = new FakeAnalyzeBoston();
    await runCapital(api);
    api.pkg.resources[0]!.last_modified = '2027-08-01T00:00:00';
    api.rows = [];
    expect((await runCapital(api)).status).toBe('error');
    expect((await sql`select count(*)::int as n from public.capital_projects`)[0]!.n).toBe(3);
  });
});

describe('sync-boston-zba', () => {
  it('stores open and recent cases, the latest row per case, without applicant names', async () => {
    const api = new FakeAnalyzeBoston();
    expect((await runZba(api)).status).toBe('ok');
    expect(api.sqlSeen[0]).toContain("hearing_date >= '2025-10-09'");
    expect(api.sqlSeen[0]).not.toMatch(/"contact"/);
    const rows = await asAnon(
      sql,
      (tx) => tx`select boa_apno, neighborhood, decision from public.zba_appeals order by 1`,
    );
    expect(rows).toEqual([
      { boa_apno: 'BOA1', neighborhood: 'Dorchester', decision: null },
      { boa_apno: 'BOA2', neighborhood: 'Roxbury', decision: 'Approved' },
    ]);
    expect((await runZba(api)).rowsWritten).toBe(0);

    // A case that leaves the window is removed.
    api.zba = api.zba.slice(0, 1);
    expect((await runZba(api)).rowsWritten).toBe(1);
    expect(await sql`select boa_apno from public.zba_appeals`).toHaveLength(1);
  });
});
