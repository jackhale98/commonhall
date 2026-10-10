/**
 * Cambridge's open data (data.cambridgema.gov, Socrata), daily:
 *
 *  - 311: the city's SeeClickFix requests ("Commonwealth Connect Service Requests",
 *    2z9k-mv9g). Only four columns of the last 62 days are read (when opened, when
 *    closed, category, status: never the address, description or photo), counted per
 *    day and category here, and stored as the report the site shows (report-311.ts).
 *    The city sets no target times, so the report says so (onTime: false), and
 *    Cambridge elects its council citywide, so there are no districts.
 *  - Operating budget (5bn4-5wey) and revenues (ixyv-mje6): adopted budgets by
 *    fiscal year, summed on the portal per department, division and category (the
 *    files split each line by fund and object), the newest three years.
 *  - Capital budget (9chi-2ed3): the five-year plan, one row per project, year and
 *    fund; stored per project as Boston's plan is (this year, later years, total).
 *
 * Zoning appeals (urfm-usws) are not loaded: the table has no hearing dates or
 * decisions, and few cases since 2025 (see docs/decisions.md).
 */
import { REPORT_311_DAYS, checkKept, report311, type Day311, type SocrataClient } from '@civic/congress-client';
import { upsertIfChanged, type Sql } from '../db.ts';
import type { JobRun } from '../job.ts';
import { addDays, bostonToday, storeReport311 } from './boston-311.ts';

export const CAMBRIDGE_DATA_JOB = 'cambridge-data';
export const CAMBRIDGE_DATA_DOMAIN = 'data.cambridgema.gov';
const CITY = 'ma-cambridge';
export const CAMBRIDGE_DATASETS = {
  requests: '2z9k-mv9g',
  operating: '5bn4-5wey',
  revenue: 'ixyv-mje6',
  capital: '9chi-2ed3',
} as const;
/** Budget years kept: the newest and the two before (the site compares with the year before). */
const BUDGET_YEARS = 3;

export type CambridgeDataCursor = Record<string, unknown>;

// ---- 311 --------------------------------------------------------------------

export interface Cambridge311Record {
  ticket_created_date_time: string;
  ticket_closed_date_time?: string;
  issue_category?: string;
  ticket_status?: string;
}

export const CAMBRIDGE_311_SHAPE = {
  ticket_created_date_time: 'date',
  ticket_closed_date_time: 'date?',
  issue_category: 'string',
  ticket_status: 'string',
};

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Requests → counts per day and category (the shape every city's report is built
 * from). Times are the city's local wall-clock times; a request counts as closed
 * when it has a close time or its status says so ("Closed", "Archived").
 */
export function cambridge311Days(records: Cambridge311Record[]): Day311[] {
  const groups = new Map<string, { day: string; type: string; opened: number; closed: number; hours: number[] }>();
  for (const r of records) {
    const day = /^\d{4}-\d{2}-\d{2}/.exec(r.ticket_created_date_time ?? '')?.[0];
    if (!day) continue;
    const type = (r.issue_category ?? '').trim() || 'Other';
    const key = `${day}|${type}`;
    const g = groups.get(key) ?? { day, type, opened: 0, closed: 0, hours: [] };
    g.opened += 1;
    const closedAt = r.ticket_closed_date_time ? Date.parse(r.ticket_closed_date_time) : NaN;
    if (Number.isFinite(closedAt) || /^(closed|archived)$/i.test(r.ticket_status ?? '')) {
      g.closed += 1;
      const opened = Date.parse(r.ticket_created_date_time);
      if (Number.isFinite(closedAt) && closedAt >= opened) g.hours.push((closedAt - opened) / 3_600_000);
    }
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const m = median(g.hours);
    return {
      day: g.day,
      district: 0,
      request_type: g.type,
      source: 'seeclickfix',
      opened: g.opened,
      closed: g.closed,
      closed_on_time: 0,
      median_close_hours: m === null ? null : Math.round(m * 100) / 100,
    };
  });
}

async function sync311(run: JobRun<CambridgeDataCursor>, client: SocrataClient, now: Date) {
  const today = bostonToday(now);
  const yesterday = addDays(today, -1);
  const oldest = addDays(today, -REPORT_311_DAYS);
  const records = await client.all<Cambridge311Record>(
    CAMBRIDGE_DATASETS.requests,
    {
      $select: 'ticket_created_date_time,ticket_closed_date_time,issue_category,ticket_status',
      $where: `ticket_created_date_time >= '${oldest}T00:00:00' AND ticket_created_date_time < '${today}T00:00:00'`,
      $order: 'ticket_created_date_time',
    },
    CAMBRIDGE_311_SHAPE,
  );
  const report = report311(cambridge311Days(records), { districts: 0, onTime: false });
  if (!report || report.city.opened === 0) throw new Error('Cambridge 311: no requests came back for the last month');
  if (report.to < addDays(yesterday, -3)) run.log('cambridge-311: the newest requests are old', { to: report.to });
  run.rowsWritten += await storeReport311(run.sql, CITY, report);
  run.log('cambridge-311', { read: records.length, from: report.from, to: report.to, opened: report.city.opened });
}

// ---- Operating budget and revenue -------------------------------------------

export interface CambridgeBudgetRow extends Record<string, unknown> {
  city: string;
  kind: 'expense' | 'revenue';
  cabinet: string;
  dept: string;
  grouping: string;
  line: string;
  fiscal_year: number;
  basis: 'budget';
  amount: number;
}

const text = (v: unknown) => String(v ?? '').trim();

/** A portal summary row (one department, division and category in a year) as a stored line. */
export function cambridgeBudgetRow(kind: 'expense' | 'revenue', r: Record<string, unknown>): CambridgeBudgetRow | null {
  const year = Number(r.fiscal_year);
  const amount = Number(r.amount);
  if (!Number.isInteger(year) || !Number.isFinite(amount)) return null;
  return {
    city: CITY,
    kind,
    // Cambridge groups departments by "service" (Public Safety, Education, …), Boston by cabinet.
    cabinet: text(r.service),
    dept: text(r.department_name),
    grouping: kind === 'expense' ? text(r.division_name) : text(r.category),
    line: kind === 'expense' ? text(r.category) : text(r.description),
    fiscal_year: year,
    basis: 'budget',
    amount: Math.round(amount * 100) / 100,
  };
}

const BUDGET_SHAPES = {
  expense: {
    fiscal_year: 'string|number',
    service: 'string',
    department_name: 'string',
    division_name: 'string',
    category: 'string',
    amount: 'string|number',
  },
  revenue: {
    fiscal_year: 'string|number',
    service: 'string',
    department_name: 'string',
    category: 'string',
    description: 'string',
    amount: 'string|number',
  },
};

/** Merge rows that share a key (labels the city left blank). */
function mergeBudget(rows: CambridgeBudgetRow[]) {
  const byKey = new Map<string, CambridgeBudgetRow>();
  for (const r of rows) {
    const key = [r.kind, r.cabinet, r.dept, r.grouping, r.line, r.fiscal_year].join('|');
    const seen = byKey.get(key);
    if (seen) seen.amount = Math.round((seen.amount + r.amount) * 100) / 100;
    else byKey.set(key, { ...r });
  }
  return [...byKey.values()];
}

async function syncBudget(run: JobRun<CambridgeDataCursor>, client: SocrataClient) {
  for (const kind of ['expense', 'revenue'] as const) {
    const dataset = kind === 'expense' ? CAMBRIDGE_DATASETS.operating : CAMBRIDGE_DATASETS.revenue;
    const [latest] = await client.query<{ fy: string }>(dataset, { $select: 'max(fiscal_year) as fy' });
    const newest = Number(latest?.fy);
    if (!Number.isInteger(newest)) throw new Error(`Cambridge ${kind} budget: no fiscal years`);
    const fields =
      kind === 'expense'
        ? 'fiscal_year,service,department_name,division_name,category'
        : 'fiscal_year,service,department_name,category,description';
    const records = await client.all<Record<string, unknown>>(
      dataset,
      {
        $select: `${fields},sum(amount) as amount`,
        $where: `fiscal_year > ${newest - BUDGET_YEARS}`,
        $group: fields,
        $order: fields,
      },
      BUDGET_SHAPES[kind],
    );
    const mapped = records.map((r) => cambridgeBudgetRow(kind, r));
    checkKept(`Cambridge ${kind} budget`, records.length, mapped.filter((r) => r !== null).length);
    const rows = mergeBudget(mapped.filter((r) => r !== null));
    if (rows.length === 0) throw new Error(`Cambridge ${kind} budget came back empty; keeping the stored rows`);
    run.rowsWritten += await replaceBudget(run.sql, kind, rows);
    run.log('cambridge-budget', { kind, newest, rows: rows.length });
  }
}

async function replaceBudget(sql: Sql, kind: 'expense' | 'revenue', rows: CambridgeBudgetRow[]): Promise<number> {
  return sql.begin(async (tx) => {
    const changed = await tx`
      insert into public.city_budget_lines as t (city, kind, cabinet, dept, grouping, line, fiscal_year, basis, amount)
      select city, kind, cabinet, dept, grouping, line, fiscal_year, basis, amount
        from jsonb_to_recordset(${tx.json(rows as never)}::jsonb) as x(
          city text, kind text, cabinet text, dept text, grouping text, line text,
          fiscal_year smallint, basis text, amount numeric)
      on conflict (city, kind, cabinet, dept, grouping, line, fiscal_year, basis) do update
        set amount = excluded.amount, updated_at = now()
        where t.amount is distinct from excluded.amount
      returning 1`;
    const keys = rows.map((r) => [r.cabinet, r.dept, r.grouping, r.line, r.fiscal_year, r.basis].join('|'));
    const gone = await tx`
      delete from public.city_budget_lines
       where city = ${CITY} and kind = ${kind}
         and (cabinet || '|' || dept || '|' || grouping || '|' || line || '|' || fiscal_year || '|' || basis)
             <> all(${keys}::text[])
      returning 1`;
    return changed.length + gone.length;
  });
}

// ---- Capital plan -----------------------------------------------------------

export interface CambridgeCapitalRecord {
  fiscal_year: string | number;
  department?: string;
  project_id?: string;
  project_name?: string;
  fund?: string;
  city_location?: string;
  approved_amount?: string | number;
}

export const CAMBRIDGE_CAPITAL_SHAPE = {
  fiscal_year: 'string|number',
  department: 'string',
  project_id: 'string?',
  project_name: 'string',
  fund: 'string',
  approved_amount: 'string|number',
};

/**
 * The newest five-year plan as capital_projects rows: year 1 is the plan's first
 * year (the budget the council adopts), years 2–5 the rest, the total all five.
 * The city publishes no spending to date, so `spent` stays 0. Earlier years'
 * rows have no project id and are left out.
 */
export function cambridgeCapitalProjects(records: CambridgeCapitalRecord[]) {
  const years = records.map((r) => Number(r.fiscal_year)).filter(Number.isInteger);
  if (years.length === 0) return [];
  const first = Math.max(...years) - 4;
  const plan = `FY${String(first).slice(2)}-${String(first + 4).slice(2)}`;
  const byId = new Map<
    string,
    Record<string, unknown> & { proj_id: string; total_budget: number; year1: number; years_2_5: number }
  >();
  for (const r of records) {
    const year = Number(r.fiscal_year);
    const id = text(r.project_id);
    if (!id || year < first) continue;
    const amount = Number(r.approved_amount) || 0;
    const p =
      byId.get(id) ??
      ({
        proj_id: id,
        city: CITY,
        plan,
        first_year: first,
        department: text(r.department) || null,
        name: text(r.project_name).replace(/\s+/g, ' '),
        scope: null,
        status: null,
        neighborhood: text(r.city_location) || null,
        pm_department: null,
        total_budget: 0,
        spent: 0,
        year0: 0,
        year1: 0,
        years_2_5: 0,
        external_funds: 0,
      } as Record<string, unknown> & { proj_id: string; total_budget: number; year1: number; years_2_5: number });
    p.total_budget += amount;
    if (year === first) p.year1 += amount;
    else p.years_2_5 += amount;
    byId.set(id, p);
  }
  return [...byId.values()].filter((p) => p.name && p.total_budget > 0);
}

async function syncCapital(run: JobRun<CambridgeDataCursor>, client: SocrataClient) {
  const records = await client.all<CambridgeCapitalRecord>(
    CAMBRIDGE_DATASETS.capital,
    {
      $select: 'fiscal_year,department,project_id,project_name,fund,city_location,approved_amount',
      $order: 'fiscal_year,project_id',
    },
    CAMBRIDGE_CAPITAL_SHAPE,
  );
  const rows = cambridgeCapitalProjects(records);
  if (rows.length < 10)
    throw new Error(`Cambridge capital plan read as ${rows.length} projects; keeping the stored plan`);
  let written = 0;
  for (const row of rows)
    if (await upsertIfChanged(run.sql, 'public.capital_projects', ['city', 'proj_id'], row)) written += 1;
  const gone = await run.sql`
    delete from public.capital_projects
     where city = ${CITY} and proj_id <> all(${rows.map((r) => r.proj_id)}::text[]) returning 1`;
  run.rowsWritten += written + gone.length;
  run.log('cambridge-capital', { plan: rows[0]!.plan, projects: rows.length, written });
}

export async function syncCambridgeData(
  run: JobRun<CambridgeDataCursor>,
  options: { client: SocrataClient; now?: () => Date },
): Promise<CambridgeDataCursor> {
  const now = options.now?.() ?? new Date();
  // Each part stands alone: one failing (a renamed column) doesn't keep the others from updating.
  const failures: string[] = [];
  for (const [name, part] of [
    ['311', () => sync311(run, options.client, now)],
    ['budget', () => syncBudget(run, options.client)],
    ['capital', () => syncCapital(run, options.client)],
  ] as const) {
    try {
      await part();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
  return { checkedAt: now.toISOString() };
}
