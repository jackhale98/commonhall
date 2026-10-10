/**
 * Boston's five-year Capital Plan from Analyze Boston ("capital-budget"): one row
 * per project with its total budget, what has been spent and what is planned for
 * the coming years. The city publishes a new plan once a year; a weekly run reads
 * the 300-odd rows and writes only what changed.
 */
import { checkKept, checkShape, datastoreResource, type AnalyzeBostonClient, type Shape } from '@civic/congress-client';
import { upsertIfChanged } from '../db.ts';
import type { JobRun } from '../job.ts';

export const CAPITAL_PLAN_JOB = 'capital-plan';
export const CAPITAL_PLAN_DATASET = 'capital-budget';

export interface CapitalPlanCursor {
  [key: string]: unknown;
  plan?: string;
  resourceModified?: string;
}

export interface CapitalProjectRow extends Record<string, unknown> {
  proj_id: string;
  plan: string;
  first_year: number | null;
  department: string | null;
  name: string;
  scope: string | null;
  status: string | null;
  neighborhood: string | null;
  pm_department: string | null;
  total_budget: number;
  spent: number;
  year0: number;
  year1: number;
  years_2_5: number;
  external_funds: number;
}

/** Dollars from the portal's text columns ("4125000", "$1,200", ""). */
export function dollars(v: unknown): number {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** "FY27-31" and 2027 from a file name such as fy27-31-adopted-capital-plan….csv. */
export function planFromUrl(url: string | undefined): { plan: string; firstYear: number | null } {
  const m = /fy(\d{2})-(\d{2})/i.exec(url ?? '');
  return m ? { plan: `FY${m[1]}-${m[2]}`, firstYear: 2000 + Number(m[1]) } : { plan: 'Current', firstYear: null };
}

const text = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

export function capitalProjectRow(
  r: Record<string, unknown>,
  plan: string,
  firstYear: number | null,
): CapitalProjectRow | null {
  const id = text(r['Proj ID']);
  const name = text(r.Project_Name);
  if (!id || !name) return null;
  const sum = (...keys: string[]) => keys.reduce((n, k) => n + dollars(r[k]), 0);
  return {
    proj_id: id,
    plan,
    first_year: firstYear,
    department: text(r.Department),
    name,
    scope: text(r.Scope_Of_Work),
    status: text(r.Project_Status),
    neighborhood: text(r.Neighborhood),
    pm_department: text(r.PM_Department),
    total_budget: dollars(r.Total_Project_Budget),
    spent: sum('GO_Expended', 'OC_Expended', 'Grant_Expended'),
    // Column names are inconsistent in the city's file (CapitalYear_1, OCYear_25).
    year0: sum('Capital_Year_0', 'OC_Year_0', 'Grant_Year_0'),
    year1: sum('CapitalYear_1', 'Capital_Year_1', 'OC_Year_1', 'Grant_Year_1'),
    years_2_5: sum('Capital_Year_25', 'OCYear_25', 'OC_Year_25', 'GrantYear_25', 'Grant_Year_25'),
    external_funds: dollars(r.External_Funds),
  };
}

/**
 * Projects whose parts do not add up to their total budget (expended + year 0 +
 * year 1 + years 2–5 + external funds), per the city's data dictionary. The site
 * shows any difference as "not broken down"; the sync logs them so a change in the
 * city's columns is noticed.
 */
export function unbalancedProjects(rows: CapitalProjectRow[]): string[] {
  return rows
    .filter((r) => Math.abs(r.total_budget - (r.spent + r.year0 + r.year1 + r.years_2_5 + r.external_funds)) >= 1)
    .map((r) => r.proj_id);
}

/** The Capital Plan columns read by name (values come as text or numbers). */
export const CAPITAL_PLAN_SHAPE = {
  'Proj ID': 'string|number',
  Project_Name: 'string',
  Department: 'string',
  Project_Status: 'string',
  Neighborhood: 'string',
  Total_Project_Budget: 'string|number',
  External_Funds: 'string|number',
  Scope_Of_Work: 'string',
} satisfies Shape;

export async function syncCapitalPlan(
  run: JobRun<CapitalPlanCursor>,
  options: { client: AnalyzeBostonClient },
): Promise<CapitalPlanCursor> {
  const pkg = await options.client.packageShow(CAPITAL_PLAN_DATASET);
  const resource = datastoreResource(pkg);
  if (!resource) throw new Error('Capital Plan: no datastore table in the dataset');
  const { plan, firstYear } = planFromUrl(resource.url);
  if (run.cursor.resourceModified === resource.last_modified && run.cursor.plan === plan) {
    run.log('capital-plan: unchanged', { plan });
    return run.cursor;
  }
  const records: Record<string, unknown>[] = [];
  for await (const r of options.client.all<Record<string, unknown>>(resource.id)) records.push(r);
  // The columns read by name: a renamed one would quietly zero budgets or drop projects.
  checkShape('Capital Plan table', records, CAPITAL_PLAN_SHAPE);
  const rows = records.map((r) => capitalProjectRow(r, plan, firstYear)).filter((r) => r !== null);
  checkKept('Capital Plan table', records.length, rows.length);
  if (rows.length === 0) throw new Error('Capital Plan: the table came back empty; keeping the stored plan');
  for (const row of rows) {
    if (await upsertIfChanged(run.sql, 'public.capital_projects', ['proj_id'], row)) run.rowsWritten++;
  }
  // Projects no longer in the plan.
  const gone = await run.sql`
    delete from public.capital_projects where proj_id <> all(${rows.map((r) => r.proj_id)}::text[]) returning 1`;
  run.rowsWritten += gone.length;
  const unbalanced = unbalancedProjects(rows);
  run.log('capital-plan', {
    plan,
    projects: rows.length,
    written: run.rowsWritten,
    unbalanced: unbalanced.length,
    ...(unbalanced.length ? { unbalancedIds: unbalanced.slice(0, 20) } : {}),
  });
  return { plan, resourceModified: resource.last_modified ?? undefined };
}
