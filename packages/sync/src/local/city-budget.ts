/**
 * Boston's operating and revenue budgets from Analyze Boston ("operating-budget",
 * "revenue-budget"). Each file has one row per budget line with amounts in columns
 * named for their year ("FY24 Actual Expense", "FY26 Appropriation", "FY27 Budget"),
 * so the columns are recognised by pattern and the rows stored one per line and year.
 * "#Missing" cells are left out (no amount), not stored as zero, and total rows are
 * skipped (the site adds the lines up itself). A weekly run reads a
 * file only when the city has changed it, and replaces that budget's rows.
 */
import { datastoreResource, type AnalyzeBostonClient } from '@civic/congress-client';
import type { JobRun } from '../job.ts';

export const CITY_BUDGET_JOB = 'city-budget';
export const CITY_BUDGET_DATASETS = { expense: 'operating-budget', revenue: 'revenue-budget' } as const;
type Kind = keyof typeof CITY_BUDGET_DATASETS;

export interface CityBudgetCursor {
  [key: string]: unknown;
  /** last_modified of each file when it was last read. */
  expense?: string;
  revenue?: string;
}

export interface CityBudgetRow extends Record<string, unknown> {
  kind: Kind;
  cabinet: string;
  dept: string;
  grouping: string;
  line: string;
  fiscal_year: number;
  basis: 'actual' | 'appropriation' | 'budget';
  amount: number;
}

/** "FY27 Budget" → 2027 budget; "FY24 Actual Expense" → 2024 actual; other columns → null. */
export function budgetColumn(name: string): { fiscalYear: number; basis: CityBudgetRow['basis'] } | null {
  const m = /^FY\s?(\d{2})\s+(Actual(?: Expense)?|Appropriation|Budget)$/i.exec(name.trim());
  if (!m) return null;
  const basis = /^actual/i.test(m[2]!) ? 'actual' : /^appropriation/i.test(m[2]!) ? 'appropriation' : 'budget';
  return { fiscalYear: 2000 + Number(m[1]), basis };
}

/** A dollar amount, or null for "#Missing", blanks and anything else that is not a number. */
export function budgetAmount(v: unknown): number | null {
  const s = String(v ?? '')
    .trim()
    .replace(/[$,]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

const text = (v: unknown) => String(v ?? '').trim();

/** One source row as stored rows, one per year column that has an amount. */
export function cityBudgetRows(kind: Kind, r: Record<string, unknown>): CityBudgetRow[] {
  const base =
    kind === 'expense'
      ? { cabinet: text(r.Cabinet), dept: text(r.Dept), grouping: text(r.Program), line: text(r['Expense Category']) }
      : { cabinet: text(r.Cabinet), dept: text(r.Dept), grouping: text(r['Revenue Category']), line: text(r.Account) };
  // The operating file ends with a grand total (every label blank): adding it would double the budget.
  const labels = Object.values(base);
  if (labels.every((l) => !l) || labels.some((l) => /^(grand\s+)?totals?$/i.test(l))) return [];
  const out: CityBudgetRow[] = [];
  for (const [column, value] of Object.entries(r)) {
    const col = budgetColumn(column);
    const amount = col && budgetAmount(value);
    if (!col || amount === null || amount === undefined) continue;
    out.push({ kind, ...base, fiscal_year: col.fiscalYear, basis: col.basis, amount });
  }
  return out;
}

export async function syncCityBudget(
  run: JobRun<CityBudgetCursor>,
  options: { client: AnalyzeBostonClient },
): Promise<CityBudgetCursor> {
  const cursor = { ...run.cursor };
  for (const kind of ['expense', 'revenue'] as const) {
    const resource = datastoreResource(await options.client.packageShow(CITY_BUDGET_DATASETS[kind]));
    if (!resource) throw new Error(`City budget: no datastore table in ${CITY_BUDGET_DATASETS[kind]}`);
    if (resource.last_modified && cursor[kind] === resource.last_modified) {
      run.log(`city-budget: ${kind} unchanged`);
      continue;
    }
    const rows: CityBudgetRow[] = [];
    for await (const r of options.client.all<Record<string, unknown>>(resource.id))
      rows.push(...cityBudgetRows(kind, r));
    if (rows.length === 0) throw new Error(`City budget: ${kind} file came back empty; keeping the stored rows`);
    // Replace this budget's rows in one transaction, counting only real changes.
    run.rowsWritten += await run.sql.begin(async (tx) => {
      const changed = await tx`
        insert into public.city_budget_lines as t (kind, cabinet, dept, grouping, line, fiscal_year, basis, amount)
        select kind, cabinet, dept, grouping, line, fiscal_year, basis, amount
          from jsonb_to_recordset(${tx.json(rows as never)}::jsonb) as x(
            kind text, cabinet text, dept text, grouping text, line text,
            fiscal_year smallint, basis text, amount numeric)
        on conflict (kind, cabinet, dept, grouping, line, fiscal_year, basis) do update
          set amount = excluded.amount, updated_at = now()
          where t.amount is distinct from excluded.amount
        returning 1`;
      const keys = rows.map((r) => [r.cabinet, r.dept, r.grouping, r.line, r.fiscal_year, r.basis].join('|'));
      const gone = await tx`
        delete from public.city_budget_lines
         where kind = ${kind}
           and (cabinet || '|' || dept || '|' || grouping || '|' || line || '|' || fiscal_year || '|' || basis)
               <> all(${keys}::text[])
        returning 1`;
      return changed.length + gone.length;
    });
    if (resource.last_modified) cursor[kind] = resource.last_modified;
    run.log('city-budget', { kind, rows: rows.length });
  }
  return cursor;
}
