import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AnalyzeBostonClient, type FetchLike } from '@civic/congress-client';
import {
  BOSTON_311_JOB,
  CAPITAL_PLAN_JOB,
  CITY_BUDGET_JOB,
  ZBA_JOB,
  runJob,
  syncBoston311,
  syncCityBudget,
  syncCapitalPlan,
  syncZoningAppeals,
  type Boston311Cursor,
  type CapitalPlanCursor,
  type CityBudgetCursor,
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
    // A rescheduled hearing repeats the case number: the later row wins.
    { boa_apno: 'BOA3', city: 'Roxbury', status: 'Hearing Scheduled', hearing_date: '2026-10-15', decision: null },
    { boa_apno: 'BOA3', city: 'Roxbury', status: 'Hearing Rescheduled', hearing_date: '2026-11-05', decision: null },
    // Heard already: never stored by address, even if the city's query returns it.
    { boa_apno: 'BOA2', city: 'Roxbury', status: 'Appeal Closed', hearing_date: '2026-04-01', decision: 'Approved' },
  ];
  zbaCounts: Record<string, unknown>[] = [
    { neighborhood: 'Roxbury', decision: 'Approved', cases: 4 },
    { neighborhood: 'Roxbury', decision: 'AppProv', cases: 2 },
    { neighborhood: 'Roxbury', decision: 'DeniedPrej', cases: 1 },
    { neighborhood: 'Roxbury', decision: 'Denied', cases: 1 },
    { neighborhood: 'Roxbury', decision: '', cases: 9 },
  ];
  sqlSeen: string[] = [];
  calls: URL[] = [];
  fetch: FetchLike = async (input) => {
    const url = new URL(input);
    this.calls.push(url);
    if (url.pathname.endsWith('/package_show')) return ok(this.pkg);
    if (url.pathname.endsWith('/datastore_search_sql')) {
      const query = url.searchParams.get('sql')!;
      this.sqlSeen.push(query);
      return ok({ records: query.includes('count(distinct') ? this.zbaCounts : this.zba });
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
  await sql`delete from public.zba_decision_counts`;
  await sql`delete from public.boston_311_daily`;
  await sql`delete from public.city_budget_lines`;
  await sql`delete from public.sync_state where job in (${CAPITAL_PLAN_JOB}, ${ZBA_JOB}, ${BOSTON_311_JOB}, ${CITY_BUDGET_JOB})`;
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
  it('stores upcoming hearings by address and past decisions only as counts', async () => {
    const api = new FakeAnalyzeBoston();
    expect((await runZba(api)).status).toBe('ok');
    expect(api.sqlSeen.join('\n')).toContain("hearing_date >= '2026-10-09'");
    expect(api.sqlSeen.join('\n')).not.toMatch(/"contact"|\bcontact\b/);
    const rows = await asAnon(
      sql,
      (tx) => tx`select boa_apno, neighborhood, hearing_date::text from public.zba_appeals order by 1`,
    );
    expect(rows).toEqual([
      { boa_apno: 'BOA1', neighborhood: 'Dorchester', hearing_date: '2026-10-22' },
      { boa_apno: 'BOA3', neighborhood: 'Roxbury', hearing_date: '2026-11-05' },
    ]);
    const counts = await asAnon(
      sql,
      (tx) => tx`select neighborhood, decision, cases from public.zba_decision_counts order by 2`,
    );
    expect(counts).toEqual([
      { neighborhood: 'Roxbury', decision: 'Approved', cases: 4 },
      { neighborhood: 'Roxbury', decision: 'Approved with provisos', cases: 2 },
      { neighborhood: 'Roxbury', decision: 'Denied', cases: 2 },
    ]);
    expect((await runZba(api)).rowsWritten).toBe(0);

    // Once a hearing is no longer upcoming, its address leaves the database.
    api.zba = api.zba.slice(0, 1);
    expect((await runZba(api)).rowsWritten).toBe(1);
    expect(await sql`select boa_apno from public.zba_appeals`).toEqual([{ boa_apno: 'BOA1' }]);
  });
});

/** The 311 dataset: the new system and the 2026 legacy table, each answering every query with `records`. */
class Fake311 {
  pkg = {
    name: '311-service-requests',
    title: '311',
    metadata_modified: '',
    resources: [
      {
        id: 'new-system',
        name: '311 Service Requests - NEW SYSTEM',
        format: 'CSV',
        datastore_active: true,
        last_modified: null,
      },
      {
        id: 'legacy-2026',
        name: '311 Service Requests - 2026',
        format: 'CSV',
        datastore_active: true,
        last_modified: null,
      },
    ],
  };
  records: Record<string, unknown>[] = [
    {
      day: '2026-10-08',
      district: '7',
      request_type: 'Rodent Activity',
      opened: 3,
      closed: 2,
      closed_on_time: 2,
      median_close_hours: 5,
    },
    {
      day: '2026-08-01',
      district: null,
      request_type: 'Litter',
      opened: 1,
      closed: 1,
      closed_on_time: 0,
      median_close_hours: 30,
    },
  ];
  tables: string[] = [];
  fetch: FetchLike = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/package_show')) return ok(this.pkg);
    const query = url.searchParams.get('sql')!;
    this.tables.push(/FROM "([^"]+)"/.exec(query)![1]!);
    return ok({ records: this.records });
  };
}

const run311 = (api: Fake311, timeLimitMs = 60_000) =>
  runJob<Boston311Cursor>({
    sql,
    job: BOSTON_311_JOB,
    timeLimitMs,
    log: () => undefined,
    run: (ctx) =>
      syncBoston311(ctx, {
        client: new AnalyzeBostonClient({ fetch: api.fetch }),
        now: () => new Date('2026-10-09T12:00:00Z'),
      }),
  });

describe('sync-boston-311', () => {
  it('stores counts from both systems, saves its place in the backfill and rewrites nothing unchanged', async () => {
    const api = new Fake311();
    // Out of time straight after the recent fortnight: the backfill waits for the next run.
    const first = await run311(api, 1);
    expect(first.status).toBe('ok');
    expect(first.cursor).toMatchObject({ backfilledFrom: '2026-09-25', loadedTo: '2026-10-08' });
    expect(await sql`select 1 from public.boston_311_daily where day = '2026-08-01'`).toHaveLength(0);

    const second = await run311(api);
    expect(second.cursor).toMatchObject({ backfilledFrom: '2026-07-11' });
    expect(new Set(api.tables)).toEqual(new Set(['new-system', 'legacy-2026']));
    const rows = await asAnon(
      sql,
      (tx) => tx`select day::text, district, request_type, source, opened from public.boston_311_daily order by 1, 4`,
    );
    expect(rows).toEqual([
      { day: '2026-08-01', district: 0, request_type: 'Litter', source: 'legacy', opened: 1 },
      { day: '2026-08-01', district: 0, request_type: 'Litter', source: 'new', opened: 1 },
      { day: '2026-10-08', district: 7, request_type: 'Rodent Activity', source: 'legacy', opened: 3 },
      { day: '2026-10-08', district: 7, request_type: 'Rodent Activity', source: 'new', opened: 3 },
    ]);
    expect((await run311(api)).rowsWritten).toBe(0);

    // A late closure updates the day; a type that disappears from a re-read day is removed.
    api.records = [{ ...api.records[0]!, closed: 3 }];
    expect((await run311(api)).rowsWritten).toBe(2);
    expect(await sql`select closed from public.boston_311_daily where day = '2026-10-08'`).toEqual([
      { closed: 3 },
      { closed: 3 },
    ]);
  });
});

/** The operating and revenue budgets, shaped like the city's files (with the operating file's grand total). */
class FakeBudget {
  modified = '2026-08-03T14:44:14';
  expense: Record<string, unknown>[] = [
    {
      _id: 1,
      Cabinet: 'Education Cabinet',
      Dept: 'Boston Public Schools',
      Program: 'K-8',
      'Expense Category': 'Personnel Services',
      'FY24 Actual Expense': '#Missing',
      'FY25 Actual Expense': '90',
      'FY26 Appropriation': '95',
      'FY27 Budget': '100',
    },
    {
      _id: 2,
      Cabinet: 'Public Safety Cabinet',
      Dept: 'Police Department',
      Program: 'Patrol',
      'Expense Category': 'Personnel Services',
      'FY24 Actual Expense': '40',
      'FY25 Actual Expense': '45',
      'FY26 Appropriation': '50',
      'FY27 Budget': '50',
    },
    {
      _id: 3,
      Cabinet: '',
      Dept: '',
      Program: '',
      'Expense Category': '',
      'FY24 Actual Expense': '40',
      'FY25 Actual Expense': '135',
      'FY26 Appropriation': '145',
      'FY27 Budget': '150',
    },
  ];
  revenue: Record<string, unknown>[] = [
    {
      _id: 1,
      'Revenue Category': 'Property Tax',
      Account: 'Real Estate Tax',
      Cabinet: 'Finance',
      Dept: 'Collecting Division',
      'FY24 Actual': 100,
      'FY25 Actual': 105,
      'FY26 Budget': 110,
      'FY27 Budget': 112,
    },
    {
      _id: 2,
      'Revenue Category': 'State Aid',
      Account: 'Chapter 70',
      Cabinet: 'Finance',
      Dept: 'Budget Office',
      'FY24 Actual': 30,
      'FY25 Actual': 33,
      'FY26 Budget': 35,
      'FY27 Budget': 38,
    },
  ];
  fetch: FetchLike = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/package_show')) {
      const kind = url.searchParams.get('id') === 'operating-budget' ? 'expense' : 'revenue';
      return ok({
        name: url.searchParams.get('id'),
        title: '',
        metadata_modified: '',
        resources: [{ id: kind, name: kind, format: 'CSV', datastore_active: true, last_modified: this.modified }],
      });
    }
    const rows = url.searchParams.get('resource_id') === 'expense' ? this.expense : this.revenue;
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    return ok({ records: rows.slice(offset, offset + limit), total: rows.length });
  };
}

const runBudget = (api: FakeBudget) =>
  runJob<CityBudgetCursor>({
    sql,
    job: CITY_BUDGET_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) => syncCityBudget(ctx, { client: new AnalyzeBostonClient({ fetch: api.fetch }) }),
  });

describe('sync-city-budget', () => {
  it('stores each line and year, skips the grand total and "#Missing", and replaces changed files', async () => {
    const api = new FakeBudget();
    expect((await runBudget(api)).status).toBe('ok');
    const totals = await asAnon(
      sql,
      (tx) => tx`select kind, fiscal_year, basis, sum(amount)::float as total, count(*)::int as n
                   from public.city_budget_lines group by 1, 2, 3 order by 1, 2`,
    );
    expect(totals).toEqual([
      { kind: 'expense', fiscal_year: 2024, basis: 'actual', total: 40, n: 1 },
      { kind: 'expense', fiscal_year: 2025, basis: 'actual', total: 135, n: 2 },
      { kind: 'expense', fiscal_year: 2026, basis: 'appropriation', total: 145, n: 2 },
      { kind: 'expense', fiscal_year: 2027, basis: 'budget', total: 150, n: 2 },
      { kind: 'revenue', fiscal_year: 2024, basis: 'actual', total: 130, n: 2 },
      { kind: 'revenue', fiscal_year: 2025, basis: 'actual', total: 138, n: 2 },
      { kind: 'revenue', fiscal_year: 2026, basis: 'budget', total: 145, n: 2 },
      { kind: 'revenue', fiscal_year: 2027, basis: 'budget', total: 150, n: 2 },
    ]);
    // Unchanged files are not read again.
    expect((await runBudget(api)).rowsWritten).toBe(0);

    // A new file without the Police line: its four years leave.
    api.modified = '2027-08-01T00:00:00';
    api.expense = api.expense.filter((r) => r.Dept !== 'Police Department');
    expect((await runBudget(api)).rowsWritten).toBe(4);
    expect(await sql`select 1 from public.city_budget_lines where dept = 'Police Department'`).toHaveLength(0);
  });
});
