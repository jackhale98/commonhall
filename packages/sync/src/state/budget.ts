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
 *
 * Connecticut: the Office of the State Comptroller's expense data on data.ct.gov
 * ("State of CT Expense Data 2012 – Present", 43fc-9893), the data behind its
 * OpenBudget site, refreshed after each monthly close. One line per fund, agency and
 * program, summed on the portal, for the funds the General Assembly appropriates (the
 * General Fund, the Special Transportation Fund and the smaller budgeted funds); federal
 * and other restricted funds, capital projects and pension funds are left out, their
 * "recommended" amounts being multi-year authority rather than the year's budget. The
 * two amounts are the dataset's own, unchanged: "Recommended Amount" (stored as the
 * line's budget; OpenBudget compares spending with it as "what was budgeted") and
 * "Actual Amount" (spent). The agency is the line's grouping and the Comptroller's
 * service area (Human Services, Corrections, …) its category.
 *
 * Connecticut's towns: the Office of Policy and Management's summary of adopted
 * municipal budgets (pcg4-s5rc), one row per town and year: revenue by source,
 * education, debt service, total spending and mill rates. Six years are kept.
 */
import { checkKept, soqlString, type Shape, type SocrataClient } from '@civic/congress-client';
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

export const CT_BUDGET_DOMAIN = 'data.ct.gov';
export const CT_BUDGET_DATASET = '43fc-9893';
export const CT_TOWNS_DATASET = 'pcg4-s5rc';
/** The fund types the General Assembly appropriates: the budget it passes. */
export const CT_BUDGETED_FUND_TYPES = ['General', 'Transportation', 'Other Budgeted'];
/** Fewer lines than this in the newest year means a broken read (FY27 has about 700). */
export const CT_MIN_LINES = 400;
/** Fewer towns than this in the newest year means a broken read (all 169 and the City of Groton report). */
export const CT_MIN_TOWNS = 160;
/** Fiscal years of town budgets kept. */
export const TOWN_BUDGET_YEARS = 6;

export interface StateBudgetCursor {
  [key: string]: unknown;
  /** Massachusetts: the dataset's rowsUpdatedAt when it was last read. */
  ma?: string;
  /** Connecticut's expense data, likewise. */
  ct?: string;
  /** Connecticut's town budgets, likewise. */
  ctTowns?: string;
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
  /** The fund it's paid from (Connecticut); empty for Massachusetts. */
  fund: string;
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
    fund: '',
  };
}

/** The expense data's columns the query reads. */
export const CT_BUDGET_COLUMNS = [
  'fiscal_year',
  'fund_type',
  'fund',
  'service',
  'department',
  'program',
  'recommended_amount',
  'actual_amount',
];

/** One fund, agency and program's sums for a year, as the portal returns them. */
export const CT_BUDGET_SHAPE: Shape = {
  fiscal_year: 'string|number',
  fund: 'string',
  department: 'string',
  program: 'string',
  service_area: 'string?',
  budgeted: 'string|number?',
  spent: 'string|number?',
};

/** The SoQL that sums each fund, agency and program's rows in the budgeted funds from `from` on. */
export function ctBudgetQuery(from: number) {
  return {
    // Aliases differ from the columns: SoQL reads a WHERE column named like an alias as the aggregate.
    $select:
      'fiscal_year,fund,department,program,max(service) as service_area,sum(recommended_amount) as budgeted,sum(actual_amount) as spent',
    $where: `fiscal_year >= ${from} AND fund_type in(${CT_BUDGETED_FUND_TYPES.map(soqlString).join(',')})`,
    $group: 'fiscal_year,fund,department,program',
    $order: 'fiscal_year,fund,department,program',
  };
}

/** One Connecticut line as a stored row (one account per fund, agency and program), or null when it can't be read. */
export function ctBudgetRow(r: Record<string, unknown>): StateBudgetRow | null {
  const year = Number(r.fiscal_year);
  const fund = text(r.fund);
  const department = text(r.department);
  const program = text(r.program);
  if (!Number.isInteger(year) || !fund || !department || !program) return null;
  const budgeted = money(r.budgeted);
  const spent = money(r.spent);
  if (Number.isNaN(budgeted) || Number.isNaN(spent)) return null;
  return {
    state: 'CT',
    fiscal_year: year,
    account: `${fund}|${department}|${program}`,
    account_name: program,
    department,
    cabinet: department,
    category: text(r.service_area),
    enacted: budgeted,
    supplemental: 0,
    total_enacted: budgeted,
    available: budgeted,
    spent,
    fund,
  };
}

/** The town budget dataset's columns the sync reads. */
export const CT_TOWN_COLUMNS = [
  'fiscal_period_of_budget',
  'entity_name',
  'property_tax_revenue',
  'revenues_from_state_of_ct',
  'revenues_from_federal',
  'use_of_fund_balance',
  'all_other_revenue',
  'total_revenue',
  'education_expenditures',
  'debt_service',
  'contingency_amount',
  'all_other_expenditures',
  'total_expenditures',
  'budgeted_tax_collection',
  'mill_rate_real_estate_personal',
  'mill_rate_motor_vehicle',
  'date_budget_adopted',
];

export const CT_TOWN_SHAPE: Shape = {
  fiscal_period_of_budget: 'string|number',
  entity_name: 'string',
  property_tax_revenue: 'string|number',
  total_revenue: 'string|number',
  education_expenditures: 'string|number',
  total_expenditures: 'string|number',
  revenues_from_state_of_ct: 'string|number?',
  revenues_from_federal: 'string|number?',
  mill_rate_real_estate_personal: 'string|number?',
  date_budget_adopted: 'date?',
};

export interface TownBudgetRow extends Record<string, unknown> {
  state: string;
  town: string;
  fiscal_year: number;
  property_tax: number;
  state_revenue: number;
  federal_revenue: number;
  fund_balance: number;
  other_revenue: number;
  total_revenue: number;
  education: number;
  debt_service: number;
  contingency: number;
  other_spending: number;
  total_spending: number;
  mill_rate: number | null;
  mill_rate_vehicles: number | null;
  tax_collection_rate: number | null;
  adopted_on: string | null;
}

const rate = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One town's adopted budget for a year, or null when it can't be read. */
export function townBudgetRow(r: Record<string, unknown>): TownBudgetRow | null {
  const year = Number(r.fiscal_period_of_budget);
  const town = text(r.entity_name);
  if (!Number.isInteger(year) || !town) return null;
  const amounts = {
    property_tax: money(r.property_tax_revenue),
    state_revenue: money(r.revenues_from_state_of_ct),
    federal_revenue: money(r.revenues_from_federal),
    fund_balance: money(r.use_of_fund_balance),
    other_revenue: money(r.all_other_revenue),
    total_revenue: money(r.total_revenue),
    education: money(r.education_expenditures),
    debt_service: money(r.debt_service),
    contingency: money(r.contingency_amount),
    other_spending: money(r.all_other_expenditures),
    total_spending: money(r.total_expenditures),
  };
  if (Object.values(amounts).some((n) => Number.isNaN(n))) return null;
  const adopted = text(r.date_budget_adopted).slice(0, 10);
  return {
    state: 'CT',
    town,
    fiscal_year: year,
    ...amounts,
    mill_rate: rate(r.mill_rate_real_estate_personal),
    mill_rate_vehicles: rate(r.mill_rate_motor_vehicle),
    tax_collection_rate: rate(r.budgeted_tax_collection),
    adopted_on: /^\d{4}-\d{2}-\d{2}$/.test(adopted) ? adopted : null,
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
         enacted, supplemental, total_enacted, available, spent, fund)
      select state, fiscal_year, account, account_name, department, cabinet, category,
             enacted, supplemental, total_enacted, available, spent, fund
        from jsonb_to_recordset(${tx.json(rows as never)}::jsonb) as x(
          state text, fiscal_year smallint, account text, account_name text, department text,
          cabinet text, category text, enacted numeric, supplemental numeric, total_enacted numeric,
          available numeric, spent numeric, fund text)
      on conflict (state, fiscal_year, account, department) do update
        set account_name = excluded.account_name,
            cabinet = excluded.cabinet, category = excluded.category, enacted = excluded.enacted,
            supplemental = excluded.supplemental, total_enacted = excluded.total_enacted,
            available = excluded.available, spent = excluded.spent, fund = excluded.fund,
            updated_at = now()
        where (t.account_name, t.cabinet, t.category, t.enacted, t.supplemental,
               t.total_enacted, t.available, t.spent, t.fund)
          is distinct from (excluded.account_name, excluded.cabinet,
               excluded.category, excluded.enacted, excluded.supplemental, excluded.total_enacted,
               excluded.available, excluded.spent, excluded.fund)
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

/** A state's newest year and when its source last changed, for the page's "spending through" date. */
async function markBudget(sql: Sql, state: string, newest: number, sourceUpdatedAt: string | null) {
  await sql`
    insert into public.state_budgets (state, newest_year, source_updated_at, checked_at)
    values (${state}, ${newest}, ${sourceUpdatedAt}, now())
    on conflict (state) do update
      set newest_year = excluded.newest_year, source_updated_at = excluded.source_updated_at,
          checked_at = excluded.checked_at`;
}

/** Throws when a dataset no longer has every column a query reads (a rename upstream). */
function checkColumns(label: string, meta: { name: string; columns: string[] }, wanted: string[]) {
  const missing = wanted.filter((c) => !meta.columns.includes(c));
  if (missing.length) throw new Error(`${label}: columns gone from ${meta.name}: ${missing.join(', ')}`);
}

async function syncMassachusetts(
  run: JobRun<StateBudgetCursor>,
  client: SocrataClient,
  cursor: StateBudgetCursor,
  minAccounts: number,
) {
  const meta = await client.metadata(MA_BUDGET_DATASET);
  checkColumns('Massachusetts budget', meta, MA_BUDGET_COLUMNS);
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
  await markBudget(run.sql, 'MA', newest, meta.rowsUpdatedAt);
  if (meta.rowsUpdatedAt) cursor.ma = meta.rowsUpdatedAt;
  run.log('state-budget: MA', {
    newest,
    rows: rows.length,
    accounts: newestAccounts,
    rowsUpdatedAt: meta.rowsUpdatedAt,
  });
}

async function syncConnecticut(
  run: JobRun<StateBudgetCursor>,
  client: SocrataClient,
  cursor: StateBudgetCursor,
  minLines: number,
) {
  const meta = await client.metadata(CT_BUDGET_DATASET);
  checkColumns('Connecticut budget', meta, CT_BUDGET_COLUMNS);
  if (meta.rowsUpdatedAt && cursor.ct === meta.rowsUpdatedAt) {
    run.log('state-budget: CT unchanged', { rowsUpdatedAt: meta.rowsUpdatedAt });
    return;
  }
  const [latest] = await client.query<{ fy?: string }>(CT_BUDGET_DATASET, {
    $select: 'max(fiscal_year) as fy',
    $where: "fund_type='General'",
  });
  const newest = Number(latest?.fy);
  if (!Number.isInteger(newest)) throw new Error('Connecticut budget: no fiscal years');
  const from = newest - STATE_BUDGET_YEARS + 1;
  const records = await client.all<Record<string, unknown>>(CT_BUDGET_DATASET, ctBudgetQuery(from), CT_BUDGET_SHAPE);
  const mapped = records.map(ctBudgetRow);
  checkKept('Connecticut budget', records.length, mapped.filter((r) => r !== null).length);
  const rows = mapped.filter((r) => r !== null && (r.total_enacted || r.spent)) as StateBudgetRow[];
  const newestLines = rows.filter((r) => r.fiscal_year === newest).length;
  if (newestLines < minLines)
    throw new Error(
      `Connecticut budget: FY${newest} read as ${newestLines} lines (expected over ${minLines}); keeping the stored budget`,
    );
  run.rowsWritten += await replaceLines(run.sql, 'CT', rows, from);
  await markBudget(run.sql, 'CT', newest, meta.rowsUpdatedAt);
  if (meta.rowsUpdatedAt) cursor.ct = meta.rowsUpdatedAt;
  run.log('state-budget: CT', { newest, rows: rows.length, lines: newestLines, rowsUpdatedAt: meta.rowsUpdatedAt });
}

async function syncTowns(
  run: JobRun<StateBudgetCursor>,
  client: SocrataClient,
  cursor: StateBudgetCursor,
  minTowns: number,
) {
  const meta = await client.metadata(CT_TOWNS_DATASET);
  checkColumns('Connecticut town budgets', meta, CT_TOWN_COLUMNS);
  if (meta.rowsUpdatedAt && cursor.ctTowns === meta.rowsUpdatedAt) {
    run.log('state-budget: CT towns unchanged', { rowsUpdatedAt: meta.rowsUpdatedAt });
    return;
  }
  const [latest] = await client.query<{ fy?: string }>(CT_TOWNS_DATASET, {
    $select: 'max(fiscal_period_of_budget) as fy',
  });
  const newest = Number(latest?.fy);
  if (!Number.isInteger(newest)) throw new Error('Connecticut town budgets: no fiscal years');
  const from = newest - TOWN_BUDGET_YEARS + 1;
  const records = await client.all<Record<string, unknown>>(
    CT_TOWNS_DATASET,
    { $where: `fiscal_period_of_budget >= ${from}`, $order: 'entity_name,fiscal_period_of_budget' },
    CT_TOWN_SHAPE,
  );
  const mapped = records.map(townBudgetRow);
  checkKept('Connecticut town budgets', records.length, mapped.filter((r) => r !== null).length);
  // One row per town and year; a repeated one keeps the last.
  const rows = [
    ...new Map(
      mapped.filter((r): r is TownBudgetRow => r !== null).map((r) => [`${r.town}|${r.fiscal_year}`, r]),
    ).values(),
  ];
  const towns = rows.filter((r) => r.fiscal_year === newest).length;
  if (towns < minTowns)
    throw new Error(
      `Connecticut town budgets: FY${newest} read as ${towns} towns (expected at least ${minTowns}); keeping the stored budgets`,
    );
  run.rowsWritten += await run.sql.begin(async (tx) => {
    const changed = await tx`
      insert into public.town_budgets as t
        (state, town, fiscal_year, property_tax, state_revenue, federal_revenue, fund_balance,
         other_revenue, total_revenue, education, debt_service, contingency, other_spending,
         total_spending, mill_rate, mill_rate_vehicles, tax_collection_rate, adopted_on)
      select state, town, fiscal_year, property_tax, state_revenue, federal_revenue, fund_balance,
             other_revenue, total_revenue, education, debt_service, contingency, other_spending,
             total_spending, mill_rate, mill_rate_vehicles, tax_collection_rate, adopted_on
        from jsonb_to_recordset(${tx.json(rows as never)}::jsonb) as x(
          state text, town text, fiscal_year smallint, property_tax numeric, state_revenue numeric,
          federal_revenue numeric, fund_balance numeric, other_revenue numeric, total_revenue numeric,
          education numeric, debt_service numeric, contingency numeric, other_spending numeric,
          total_spending numeric, mill_rate numeric, mill_rate_vehicles numeric,
          tax_collection_rate numeric, adopted_on date)
      on conflict (state, town, fiscal_year) do update
        set property_tax = excluded.property_tax, state_revenue = excluded.state_revenue,
            federal_revenue = excluded.federal_revenue, fund_balance = excluded.fund_balance,
            other_revenue = excluded.other_revenue, total_revenue = excluded.total_revenue,
            education = excluded.education, debt_service = excluded.debt_service,
            contingency = excluded.contingency, other_spending = excluded.other_spending,
            total_spending = excluded.total_spending, mill_rate = excluded.mill_rate,
            mill_rate_vehicles = excluded.mill_rate_vehicles,
            tax_collection_rate = excluded.tax_collection_rate, adopted_on = excluded.adopted_on,
            updated_at = now()
        where (t.property_tax, t.state_revenue, t.federal_revenue, t.fund_balance, t.other_revenue,
               t.total_revenue, t.education, t.debt_service, t.contingency, t.other_spending,
               t.total_spending, t.mill_rate, t.mill_rate_vehicles, t.tax_collection_rate, t.adopted_on)
          is distinct from (excluded.property_tax, excluded.state_revenue, excluded.federal_revenue,
               excluded.fund_balance, excluded.other_revenue, excluded.total_revenue, excluded.education,
               excluded.debt_service, excluded.contingency, excluded.other_spending,
               excluded.total_spending, excluded.mill_rate, excluded.mill_rate_vehicles,
               excluded.tax_collection_rate, excluded.adopted_on)
      returning 1`;
    const keys = rows.map((r) => `${r.town}|${r.fiscal_year}`);
    const gone = await tx`
      delete from public.town_budgets
       where state = 'CT'
         and (fiscal_year < ${from} or (town || '|' || fiscal_year) <> all(${keys}::text[]))
      returning 1`;
    return changed.length + gone.length;
  });
  if (meta.rowsUpdatedAt) cursor.ctTowns = meta.rowsUpdatedAt;
  run.log('state-budget: CT towns', { newest, rows: rows.length, towns });
}

export async function syncStateBudgets(
  run: JobRun<StateBudgetCursor>,
  options: {
    ma?: SocrataClient;
    ct?: SocrataClient;
    /** Tests with small recorded samples lower the floors. */
    minAccounts?: number;
    ctMinLines?: number;
    ctMinTowns?: number;
  },
): Promise<StateBudgetCursor> {
  const cursor = { ...run.cursor };
  const { ma, ct } = options;
  // Each part stands alone: one failing (a renamed column) doesn't keep the others from updating.
  const failures: string[] = [];
  for (const [name, part] of [
    ...(ma
      ? ([['MA', () => syncMassachusetts(run, ma, cursor, options.minAccounts ?? MA_MIN_ACCOUNTS)]] as const)
      : []),
    ...(ct
      ? ([
          ['CT', () => syncConnecticut(run, ct, cursor, options.ctMinLines ?? CT_MIN_LINES)],
          ['CT towns', () => syncTowns(run, ct, cursor, options.ctMinTowns ?? CT_MIN_TOWNS)],
        ] as const)
      : []),
  ] as const) {
    try {
      await part();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
  return cursor;
}
