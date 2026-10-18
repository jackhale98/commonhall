import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SocrataClient } from '@civic/congress-client';
import { CT_BUDGET_DOMAIN, STATE_BUDGET_JOB, runJob, syncStateBudgets, type Sql } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../packages/congress-client/test/fixtures/ct-budget/${name}`, import.meta.url)),
      'utf8',
    ),
  );

async function clean() {
  await sql`delete from public.state_budget_lines where state = 'CT'`;
  await sql`delete from public.state_budgets where state = 'CT'`;
  await sql`delete from public.town_budgets where state = 'CT'`;
  await sql`delete from public.sync_state where job = ${STATE_BUDGET_JOB}`;
  await sql`delete from public.sync_lock where job = ${STATE_BUDGET_JOB}`;
}
beforeEach(clean);
afterAll(clean);

/**
 * data.ct.gov from recorded responses (October 2026): the expense data's and town
 * budgets' descriptions, five agencies' programs for FY2025–27, and six towns' adopted
 * budgets for FY2022–26. `towns` changes the town rows.
 */
function portal(
  options: { townsUpdatedAt?: number; towns?: (rows: Record<string, unknown>[]) => Record<string, unknown>[] } = {},
) {
  const requests: string[] = [];
  const fetch = async (input: string) => {
    const url = new URL(input);
    requests.push(url.pathname);
    const select = url.searchParams.get('$select') ?? '';
    const from = Number(/>= (\d+)/.exec(url.searchParams.get('$where') ?? '')?.[1] ?? 0);
    const later = Number(url.searchParams.get('$offset') ?? 0) > 0;
    let body: unknown;
    if (url.pathname === '/api/views/43fc-9893.json') body = fixture('expense-metadata.json');
    else if (url.pathname === '/api/views/pcg4-s5rc.json') {
      const meta = fixture('towns-metadata.json');
      body = { ...meta, rowsUpdatedAt: options.townsUpdatedAt ?? meta.rowsUpdatedAt };
    } else if (select.startsWith('max(fiscal_year)')) body = fixture('expense-newest.json');
    else if (select.startsWith('max(fiscal_period_of_budget)')) body = [{ fy: '2026' }];
    else if (url.pathname === '/resource/43fc-9893.json')
      body = later
        ? []
        : (fixture('expense-rows.json') as Record<string, unknown>[]).filter((r) => Number(r.fiscal_year) >= from);
    else {
      const rows = (fixture('towns-rows.json') as Record<string, unknown>[]).filter(
        (r) => Number(r.fiscal_period_of_budget) >= from,
      );
      body = later ? [] : (options.towns?.(rows) ?? rows);
    }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  return { client: new SocrataClient(CT_BUDGET_DOMAIN, { fetch, sleep: async () => undefined }), requests };
}

const run = (client: SocrataClient, minTowns = 5) =>
  runJob({
    sql,
    job: STATE_BUDGET_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) => syncStateBudgets(ctx, { ct: client, ctMinLines: 50, ctMinTowns: minTowns }),
  });

describe('sync-state-budget (Connecticut)', () => {
  it('stores the budgeted funds’ programs and every town’s adopted budget', async () => {
    const result = await run(portal().client);
    expect(result.status).toBe('ok');
    // 298 of 300 recorded programs have an amount; six towns over five years.
    expect(result.rowsWritten).toBe(298 + 30);
    const [medicaid] = await sql<{ department: string; category: string; fund: string; total_enacted: string }[]>`
      select department, category, fund, total_enacted::text from public.state_budget_accounts
       where state = 'CT' and fiscal_year = 2027 and account_name = 'Medicaid'`;
    expect(medicaid).toEqual({
      department: 'Department of Social Services',
      category: 'Human Services',
      fund: 'General Fund',
      total_enacted: '3991912678.39',
    });
    const [budget] = await sql<
      { newest_year: number }[]
    >`select newest_year from public.state_budgets where state = 'CT'`;
    expect(budget!.newest_year).toBe(2027);
    // The totals view groups by agency (cabinet) and service area (category).
    const [dss] = await sql<{ accounts: number }[]>`
      select accounts from public.state_budget_totals
       where state = 'CT' and fiscal_year = 2027 and cabinet = 'Department of Social Services'
         and category = 'Human Services'`;
    expect(dss!.accounts).toBe(26);
    const [bristol] = await sql<{ total_spending: string; mill_rate: string; adopted_on: Date }[]>`
      select total_spending::text, mill_rate::text, adopted_on from public.town_budgets
       where state = 'CT' and town = 'BRISTOL' and fiscal_year = 2026`;
    expect(bristol!.total_spending).toBe('242658950.00');
    expect(bristol!.mill_rate).toBe('33.75');
  });

  it('reads nothing more when neither dataset has changed', async () => {
    await run(portal().client);
    const quiet = portal();
    const again = await run(quiet.client);
    expect(again.rowsWritten).toBe(0);
    expect(quiet.requests).toEqual(['/api/views/43fc-9893.json', '/api/views/pcg4-s5rc.json']);
  });

  it('keeps the stored towns when a read comes back short, and still updates the state', async () => {
    const short = await run(portal({ towns: (rows) => rows.filter((r) => r.entity_name === 'BRISTOL') }).client);
    expect(short.status).toBe('error');
    expect(await sql`select 1 from public.town_budgets where state = 'CT'`).toHaveLength(0);
    expect(await sql`select 1 from public.state_budget_lines where state = 'CT'`).toHaveLength(298);
  });

  it('removes towns no longer listed and years older than the six kept', async () => {
    await sql`insert into public.town_budgets (state, town, fiscal_year) values ('CT', 'BRISTOL', 2019), ('CT', 'NOWHERE', 2026)`;
    await run(portal().client);
    expect(
      await sql`select 1 from public.town_budgets where (town = 'BRISTOL' and fiscal_year = 2019) or town = 'NOWHERE'`,
    ).toHaveLength(0);
    // A changed town budget is rewritten on the next change of the dataset.
    const changed = await run(
      portal({
        townsUpdatedAt: 1774976900,
        towns: (rows) =>
          rows.map((r) =>
            r.entity_name === 'ANDOVER' && r.fiscal_period_of_budget === '2026'
              ? { ...r, mill_rate_real_estate_personal: '40.00' }
              : r,
          ),
      }).client,
    );
    expect(changed.rowsWritten).toBe(1);
  });
});
