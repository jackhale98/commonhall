/**
 * State budgets: what the legislature enacted, line by line, and how much has been
 * spent. Daily (pg_cron, sync-state-budget).
 *
 * Massachusetts: the Comptroller's CTHRU portal (cthru.data.socrata.com,
 * "Budget_Actual_With_Other_Spending_Authorizationv3_Gen2", kv7m-35wn), refreshed
 * daily. The portal sums the rows of each account and department (SoQL $group): an
 * account's enacted amount sits with the department it was appropriated to and its
 * spending with the department that spends it (Chapter 70 school aid is enacted under
 * Education and paid by the Department of Revenue), so the split is kept and the site
 * adds an account back together (state_budget_accounts). Rows with no amounts at all
 * are left out. A run reads about 7,000 rows for three fiscal years in two requests,
 * and only when the dataset's rowsUpdatedAt has changed since the last run.
 *
 * Amounts are the Comptroller's own columns, unchanged: the original enacted budget
 * (the GAA), supplemental budgets, the total enacted (GAA and supplementals), the total
 * available for spending (which adds retained revenue and other authorizations) and
 * total expenses (to date for the current year).
 */
import { checkKept, type Shape, type SocrataClient } from '@civic/congress-client';
import type { Sql } from '../db.ts';
import type { JobRun } from '../job.ts';

export const STATE_BUDGET_JOB = 'state-budget';
export const MA_BUDGET_DOMAIN = 'cthru.data.socrata.com';
export const MA_BUDGET_DATASET = 'kv7m-35wn';
/** Fiscal years kept: the newest and the two before (the site compares with the year before). */
export const STATE_BUDGET_YEARS = 3;
/**
 * Fewer accounts with an amount than this in the newest year means a broken read, not a
 * smaller budget (FY27 lists 1,902 accounts, 930 of them with money in October).
 */
export const MA_MIN_ACCOUNTS = 700;

export interface StateBudgetCursor {
  [key: string]: unknown;
  /** Massachusetts: the dataset's rowsUpdatedAt when it was last read. */
  ma?: string;
}

export interface StateBudgetRow extends Record<string, unknown> {
  state: string;
  fiscal_year: number;
  account: string;
  account_name: string;
  department: string;
  cabinet: string;
  category: string;
  enacted: number;
  supplemental: number;
  total_enacted: number;
  available: number;
  spent: number;
}

/** The dataset's columns the query reads; a missing one means the Comptroller renamed it. */
export const MA_BUDGET_COLUMNS = [
  'fiscal_year',
  'appropriation_account_number',
  'appropriation_account_name',
  'department_name',
  'cabinet_secretariat_name',
  'appropriation_class_name',
  'original_enacted_budget',
  'supplemental_budget_appropriations',
  'total_enacted_budget_appropriation',
  'total_available_for_spending',
  'total_expenses',
];

/** One account and department's sums for a year, as the portal returns them (numbers as strings). */
export const MA_BUDGET_SHAPE: Shape = {
  fiscal_year: 'string|number',
  appropriation_account_number: 'string',
  department_name: 'string',
  account_name: 'string',
  cabinet: 'string?',
  category: 'string?',
  enacted: 'string|number',
  supplemental: 'string|number',
  total_enacted: 'string|number',
  available: 'string|number',
  spent: 'string|number',
};

/** The SoQL that sums each account and department's rows for the fiscal years from `from` on. */
export function maBudgetQuery(from: number) {
  return {
    $select: [
      'fiscal_year',
      'appropriation_account_number',
      'department_name',
      'max(appropriation_account_name) as account_name',
      'max(cabinet_secretariat_name) as cabinet',
      'max(appropriation_class_name) as category',
      'sum(original_enacted_budget) as enacted',
      'sum(supplemental_budget_appropriations) as supplemental',
      'sum(total_enacted_budget_appropriation) as total_enacted',
      'sum(total_available_for_spending) as available',
      'sum(total_expenses) as spent',
    ].join(','),
    $where: `fiscal_year >= ${from}`,
    $group: 'fiscal_year,appropriation_account_number,department_name',
    $order: 'fiscal_year,appropriation_account_number,department_name',
  };
}

const text = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
/** Dollars to the cent; blanks are zero (the portal leaves out empty sums). */
const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

/** One account and department's sums as a stored row, or null when it can't be read (no account number or year). */
export function maBudgetRow(r: Record<string, unknown>): StateBudgetRow | null {
  const year = Number(r.fiscal_year);
  const account = text(r.appropriation_account_number);
  if (!Number.isInteger(year) || !/^\d{8}$/.test(account)) return null;
  const amounts = {
    enacted: money(r.enacted),
    supplemental: money(r.supplemental),
    total_enacted: money(r.total_enacted),
    available: money(r.available),
    spent: money(r.spent),
  };
  if (Object.values(amounts).some((n) => Number.isNaN(n))) return null;
  return {
    state: 'MA',
    fiscal_year: year,
    account,
    account_name: text(r.account_name),
    department: text(r.department_name),
    cabinet: text(r.cabinet),
    category: text(r.category),
    ...amounts,
  };
}

/**
 * Replace a state's stored lines with `rows` in one transaction: changed lines are
 * written, lines no longer in the source (or older than the years kept) are removed,
 * and unchanged lines are left alone. Returns the rows changed.
 */
async function replaceLines(sql: Sql, state: string, rows: StateBudgetRow[], from: number): Promise<number> {
  return sql.begin(async (tx) => {
    const changed = await tx`
      insert into public.state_budget_lines as t
        (state, fiscal_year, account, account_name, department, cabinet, category,
         enacted, supplemental, total_enacted, available, spent)
      select state, fiscal_year, account, account_name, department, cabinet, category,
             enacted, supplemental, total_enacted, available, spent
        from jsonb_to_recordset(${tx.json(rows as never)}::jsonb) as x(
          state text, fiscal_year smallint, account text, account_name text, department text,
          cabinet text, category text, enacted numeric, supplemental numeric, total_enacted numeric,
          available numeric, spent numeric)
      on conflict (state, fiscal_year, account, department) do update
        set account_name = excluded.account_name,
            cabinet = excluded.cabinet, category = excluded.category, enacted = excluded.enacted,
            supplemental = excluded.supplemental, total_enacted = excluded.total_enacted,
            available = excluded.available, spent = excluded.spent, updated_at = now()
        where (t.account_name, t.cabinet, t.category, t.enacted, t.supplemental,
               t.total_enacted, t.available, t.spent)
          is distinct from (excluded.account_name, excluded.cabinet,
               excluded.category, excluded.enacted, excluded.supplemental, excluded.total_enacted,
               excluded.available, excluded.spent)
      returning 1`;
    const keys = rows.map((r) => `${r.fiscal_year}|${r.account}|${r.department}`);
    const gone = await tx`
      delete from public.state_budget_lines
       where state = ${state}
         and (fiscal_year < ${from}
              or (fiscal_year || '|' || account || '|' || department) <> all(${keys}::text[]))
      returning 1`;
    return changed.length + gone.length;
  });
}

async function syncMassachusetts(
  run: JobRun<StateBudgetCursor>,
  client: SocrataClient,
  cursor: StateBudgetCursor,
  minAccounts: number,
) {
  const meta = await client.metadata(MA_BUDGET_DATASET);
  const missing = MA_BUDGET_COLUMNS.filter((c) => !meta.columns.includes(c));
  if (missing.length) throw new Error(`Massachusetts budget: columns gone from ${meta.name}: ${missing.join(', ')}`);
  if (meta.rowsUpdatedAt && cursor.ma === meta.rowsUpdatedAt) {
    run.log('state-budget: MA unchanged', { rowsUpdatedAt: meta.rowsUpdatedAt });
    return;
  }
  const [latest] = await client.query<{ fy?: string }>(MA_BUDGET_DATASET, { $select: 'max(fiscal_year) as fy' });
  const newest = Number(latest?.fy);
  if (!Number.isInteger(newest)) throw new Error('Massachusetts budget: no fiscal years');
  const from = newest - STATE_BUDGET_YEARS + 1;
  const records = await client.all<Record<string, unknown>>(MA_BUDGET_DATASET, maBudgetQuery(from), MA_BUDGET_SHAPE);
  const mapped = records.map(maBudgetRow);
  checkKept('Massachusetts budget', records.length, mapped.filter((r) => r !== null).length);
  // A department listed under an account with nothing enacted, available or spent adds nothing.
  const rows = mapped.filter(
    (r) => r !== null && (r.enacted || r.supplemental || r.total_enacted || r.available || r.spent),
  ) as StateBudgetRow[];
  const newestAccounts = new Set(rows.filter((r) => r.fiscal_year === newest).map((r) => r.account)).size;
  if (newestAccounts < minAccounts)
    throw new Error(
      `Massachusetts budget: FY${newest} read as ${newestAccounts} accounts (expected over ${minAccounts}); keeping the stored budget`,
    );
  run.rowsWritten += await replaceLines(run.sql, 'MA', rows, from);
  await run.sql`
    insert into public.state_budgets (state, newest_year, source_updated_at, checked_at)
    values ('MA', ${newest}, ${meta.rowsUpdatedAt}, now())
    on conflict (state) do update
      set newest_year = excluded.newest_year, source_updated_at = excluded.source_updated_at,
          checked_at = excluded.checked_at`;
  if (meta.rowsUpdatedAt) cursor.ma = meta.rowsUpdatedAt;
  run.log('state-budget: MA', {
    newest,
    rows: rows.length,
    accounts: newestAccounts,
    rowsUpdatedAt: meta.rowsUpdatedAt,
  });
}

export async function syncStateBudgets(
  run: JobRun<StateBudgetCursor>,
  options: { ma: SocrataClient; /** Tests with a small recorded sample lower the floor. */ minAccounts?: number },
): Promise<StateBudgetCursor> {
  const cursor = { ...run.cursor };
  await syncMassachusetts(run, options.ma, cursor, options.minAccounts ?? MA_MIN_ACCOUNTS);
  return cursor;
}
