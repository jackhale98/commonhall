import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SocrataClient } from '@civic/congress-client';
import { MA_BUDGET_DOMAIN, STATE_BUDGET_JOB, runJob, syncStateBudgets, type Sql } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../packages/congress-client/test/fixtures/cthru/${name}`, import.meta.url)),
      'utf8',
    ),
  );

async function clean() {
  await sql`delete from public.state_budget_lines where state = 'MA'`;
  await sql`delete from public.state_budgets where state = 'MA'`;
  await sql`delete from public.sync_state where job = ${STATE_BUDGET_JOB}`;
  await sql`delete from public.sync_lock where job = ${STATE_BUDGET_JOB}`;
}
beforeEach(clean);
afterAll(clean);

/**
 * CTHRU from recorded responses (October 2026): the dataset's description, its newest
 * year, and 56 accounts' sums by department for FY25–27. `edit` changes the rows.
 */
function cthru(
  options: {
    rowsUpdatedAt?: number;
    columns?: (c: string[]) => string[];
    edit?: (rows: Record<string, unknown>[]) => Record<string, unknown>[];
  } = {},
) {
  const requests: string[] = [];
  const fetch = async (input: string) => {
    const url = new URL(input);
    requests.push(url.pathname);
    let body: unknown;
    if (url.pathname === '/api/views/kv7m-35wn.json') {
      const meta = fixture('budget-metadata.json');
      body = {
        ...meta,
        rowsUpdatedAt: options.rowsUpdatedAt ?? meta.rowsUpdatedAt,
        columns: options.columns
          ? options.columns(meta.columns.map((c: { fieldName: string }) => c.fieldName)).map((fieldName) => ({
              fieldName,
            }))
          : meta.columns,
      };
    } else if ((url.searchParams.get('$select') ?? '').startsWith('max(fiscal_year)')) {
      body = fixture('budget-newest.json');
    } else {
      const from = Number(/fiscal_year >= (\d+)/.exec(url.searchParams.get('$where') ?? '')?.[1]);
      const rows = (fixture('budget-rows.json') as Record<string, unknown>[]).filter(
        (r) => Number(r.fiscal_year) >= from,
      );
      body = Number(url.searchParams.get('$offset') ?? 0) > 0 ? [] : (options.edit?.(rows) ?? rows);
    }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  const client = new SocrataClient(MA_BUDGET_DOMAIN, { fetch, sleep: async () => undefined });
  return { client, requests };
}

const run = (client: SocrataClient, minAccounts = 20) =>
  runJob({
    sql,
    job: STATE_BUDGET_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) => syncStateBudgets(ctx, { ma: client, minAccounts }),
  });

describe('sync-state-budget (Massachusetts)', () => {
  it('stores each account and department’s amounts for three years, leaving out empty ones', async () => {
    const result = await run(cthru().client);
    expect(result.status).toBe('ok');
    // 224 rows recorded, 105 with an amount.
    expect(result.rowsWritten).toBe(105);
    // Chapter 70 school aid, enacted under Education and paid by Revenue, added back together.
    const [chapter70] = await sql<{ department: string; category: string; enacted: string; spent: string }[]>`
      select department, category, enacted::text, spent::text from public.state_budget_accounts
       where state = 'MA' and fiscal_year = 2025 and account = '70610008'`;
    expect(chapter70).toEqual({
      department: 'DEPARTMENT OF ELEMENTARY & SECONDARY EDUCATION',
      category: 'Direct Local Aid',
      enacted: '6864918685.00',
      spent: '6864914827.14',
    });
    const [budget] = await sql<{ newest_year: number; source_updated_at: Date }[]>`
      select newest_year, source_updated_at from public.state_budgets where state = 'MA'`;
    expect(budget!.newest_year).toBe(2027);
    expect(budget!.source_updated_at.toISOString()).toBe(new Date(1792145503 * 1000).toISOString());
    // The totals view adds the rows up by secretariat and category; the spending sits with the payer.
    const [education] = await sql<{ total_enacted: string; spent: string }[]>`
      select sum(total_enacted)::text as total_enacted, sum(spent)::text as spent from public.state_budget_totals
       where state = 'MA' and fiscal_year = 2025 and cabinet = 'EXECUTIVE OFFICE OF EDUCATION'`;
    expect(Number(education!.total_enacted)).toBeGreaterThanOrEqual(6864918685);
    expect(
      await sql`select 1 from public.state_budget_accounts where state = 'MA' and fiscal_year = 2027`,
    ).toHaveLength(26);
  });

  it('skips an unchanged dataset, and writes only the accounts that changed', async () => {
    await run(cthru().client);
    const quiet = cthru();
    const again = await run(quiet.client);
    expect(again.rowsWritten).toBe(0);
    // Only the description was read.
    expect(quiet.requests).toEqual(['/api/views/kv7m-35wn.json']);

    const changed = await run(
      cthru({
        rowsUpdatedAt: 1792231903,
        edit: (rows) =>
          rows.map((r) =>
            r.appropriation_account_number === '70610008' &&
            r.fiscal_year === '2027.0' &&
            r.department_name === 'DEPARTMENT OF REVENUE'
              ? { ...r, spent: '3000000000.0' }
              : r,
          ),
      }).client,
    );
    expect(changed.rowsWritten).toBe(1);
    const [row] = await sql<{ spent: string }[]>`
      select spent::text from public.state_budget_accounts where state = 'MA' and fiscal_year = 2027 and account = '70610008'`;
    expect(row!.spent).toBe('3000000000.00');
  });

  it('removes years older than the three kept and accounts no longer listed', async () => {
    await sql`insert into public.state_budget_lines (state, fiscal_year, account, department)
              values ('MA', 2021, '99999999', 'X'), ('MA', 2027, '99999998', 'X')`;
    await run(cthru().client);
    expect(
      await sql`select 1 from public.state_budget_lines where state = 'MA' and account in ('99999999', '99999998')`,
    ).toHaveLength(0);
  });

  it('keeps the stored budget when the newest year reads short', async () => {
    await run(cthru().client);
    const short = await run(cthru({ rowsUpdatedAt: 1792231903 }).client, 1000);
    expect(short.status).toBe('error');
    expect(await sql`select 1 from public.state_budget_lines where state = 'MA'`).toHaveLength(105);
  });

  it('fails when a column the query needs is gone', async () => {
    const result = await run(cthru({ columns: (c) => c.filter((name) => name !== 'total_expenses') }).client);
    expect(result.status).toBe('error');
    expect(await sql`select 1 from public.state_budget_lines where state = 'MA'`).toHaveLength(0);
  });
});
