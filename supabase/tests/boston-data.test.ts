import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AnalyzeBostonClient, type FetchLike } from '@civic/congress-client';
import { CAPITAL_PLAN_JOB, runJob, syncCapitalPlan, type CapitalPlanCursor, type Sql } from '@civic/sync';
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
  calls: URL[] = [];
  fetch: FetchLike = async (input) => {
    const url = new URL(input);
    this.calls.push(url);
    if (url.pathname.endsWith('/package_show')) return ok(this.pkg);
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

beforeEach(async () => {
  await sql`delete from public.capital_projects`;
  await sql`delete from public.sync_state where job = ${CAPITAL_PLAN_JOB}`;
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
