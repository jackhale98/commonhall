/**
 * Boston 311 request summaries from Analyze Boston ("311-service-requests"). The
 * city runs two systems with different departments: the NEW SYSTEM table and the
 * legacy table published per year ("311 Service Requests - 2026"). Each run asks
 * both, in SQL on the city's side, for counts per day, council district and request
 * type, so no individual request (or address) is ever read or stored.
 *
 * Each morning it reads the last REPORT_311_DAYS of those counts (a few queries,
 * about two seconds) and stores only the report the site shows (report-311.ts): the
 * last 30 days and the 30 before, citywide and per district. The counts themselves
 * aren't kept; requests that close late are picked up because every run starts over.
 *
 * The portal's firewall refuses some SQL words (substr, extract): use left() and
 * date_part().
 */
import {
  REPORT_311_DAYS,
  report311,
  type AnalyzeBostonClient,
  type CkanPackage,
  type CkanResource,
  type Day311,
} from '@civic/congress-client';
import type { Sql } from '../db.ts';
import type { JobRun } from '../job.ts';

export const BOSTON_311_JOB = 'boston-311';
export const BOSTON_311_DATASET = '311-service-requests';
/** Days per query to the city (each answers in well under a second). */
const CHUNK_DAYS = 14;
/** Boston's nine council districts. */
const DISTRICTS = 9;
export const BOSTON_CITY = 'ma-boston';

/** The job keeps no cursor: every run rebuilds the report. */
export type Boston311Cursor = Record<string, unknown>;

export interface Boston311Row extends Day311, Record<string, unknown> {
  source: 'new' | 'legacy';
}

const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** Today in Boston, YYYY-MM-DD. */
export const bostonToday = (now: Date) => now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** The NEW SYSTEM table and the legacy tables for each year in [from, to]. */
export function resources311(pkg: CkanPackage, from: string, to: string) {
  const active = pkg.resources.filter((r) => r.datastore_active);
  const current = active.find((r) => /new system/i.test(r.name));
  const legacy = new Map<number, CkanResource>();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const r = active.find((x) => new RegExp(`311 service requests\\s*-\\s*${y}$`, 'i').test(x.name.trim()));
    if (r) legacy.set(y, r);
  }
  return { current, legacy };
}

const num = (v: unknown) => Number(v) || 0;

/** A summary row from either system's SQL (same column aliases). */
export function row311(r: Record<string, unknown>, source: 'new' | 'legacy'): Boston311Row | null {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(String(r.day ?? ''))?.[0];
  const type = String(r.request_type ?? '').trim();
  if (!day || !type) return null;
  const district = Number(String(r.district ?? '').trim());
  const median =
    r.median_close_hours === null || r.median_close_hours === undefined ? null : Number(r.median_close_hours);
  return {
    day,
    district: Number.isInteger(district) && district >= 1 && district <= 9 ? district : 0,
    request_type: type,
    source,
    opened: num(r.opened),
    closed: num(r.closed),
    closed_on_time: num(r.closed_on_time),
    median_close_hours: median === null || !Number.isFinite(median) ? null : Math.round(median * 100) / 100,
  };
}

/** Rows that share a key once districts are folded to 0 are added together (the median kept from the larger). */
export function mergeRows(rows: Boston311Row[]): Boston311Row[] {
  const byKey = new Map<string, Boston311Row>();
  for (const r of rows) {
    const key = `${r.day}|${r.district}|${r.request_type}|${r.source}`;
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, { ...r });
    else {
      if (r.closed > seen.closed) seen.median_close_hours = r.median_close_hours;
      seen.opened += r.opened;
      seen.closed += r.closed;
      seen.closed_on_time += r.closed_on_time;
    }
  }
  return [...byKey.values()];
}

/** NEW SYSTEM: text columns, UTC timestamps ("2026-10-08 14:48:04.364+00"). */
export function newSystemSql(resourceId: string, from: string, to: string): string {
  const local = `(open_date::timestamptz at time zone 'America/New_York')`;
  const closedNow = `case_status = 'Closed'`;
  return `SELECT ${local}::date AS day, city_council_district AS district, service_name AS request_type,
    count(*) AS opened,
    sum(case when ${closedNow} then 1 else 0 end) AS closed,
    sum(case when ${closedNow} and on_time = 'ONTIME' then 1 else 0 end) AS closed_on_time,
    percentile_cont(0.5) within group (order by case when ${closedNow} and close_date is not null
      then date_part('epoch', close_date::timestamptz - open_date::timestamptz) / 3600 end) AS median_close_hours
  FROM "${resourceId}"
  WHERE open_date >= '${addDays(from, -1)}' AND open_date < '${addDays(to, 2)}'
  GROUP BY 1, 2, 3`;
}

/** Legacy system: timestamp columns in Boston time. */
export function legacySql(resourceId: string, from: string, to: string): string {
  const closedNow = `case_status = 'Closed'`;
  return `SELECT open_dt::date AS day, city_council_district AS district, type AS request_type,
    count(*) AS opened,
    sum(case when ${closedNow} then 1 else 0 end) AS closed,
    sum(case when ${closedNow} and on_time = 'ONTIME' then 1 else 0 end) AS closed_on_time,
    percentile_cont(0.5) within group (order by case when ${closedNow} and closed_dt is not null
      then date_part('epoch', closed_dt - open_dt) / 3600 end) AS median_close_hours
  FROM "${resourceId}"
  WHERE open_dt >= '${from}' AND open_dt < '${addDays(to, 1)}'
  GROUP BY 1, 2, 3`;
}

/** Summaries for the days [from, to] from both systems. */
export async function fetch311(
  client: AnalyzeBostonClient,
  pkg: CkanPackage,
  from: string,
  to: string,
): Promise<Boston311Row[]> {
  const { current, legacy } = resources311(pkg, from, to);
  if (!current) throw new Error('311: the NEW SYSTEM table is missing from the dataset');
  const rows: Boston311Row[] = [];
  for (const r of await client.sql<Record<string, unknown>>(newSystemSql(current.id, from, to))) {
    const row = row311(r, 'new');
    if (row) rows.push(row);
  }
  for (const resource of legacy.values()) {
    for (const r of await client.sql<Record<string, unknown>>(legacySql(resource.id, from, to))) {
      const row = row311(r, 'legacy');
      if (row) rows.push(row);
    }
  }
  return mergeRows(rows.filter((r) => r.day >= from && r.day <= to));
}

/** Store a city's report; returns 1 when it changed. */
export async function storeReport311(sql: Sql, city: string, report: unknown): Promise<number> {
  const changed = await sql`
    insert into public.city_311_reports as t (city, report) values (${city}, ${sql.json(report as never)})
    on conflict (city) do update set report = excluded.report, updated_at = now()
    where t.report is distinct from excluded.report
    returning 1`;
  return changed.length;
}

export async function syncBoston311(
  run: JobRun<Boston311Cursor>,
  options: { client: AnalyzeBostonClient; now?: () => Date },
): Promise<Boston311Cursor> {
  const today = bostonToday(options.now?.() ?? new Date());
  const yesterday = addDays(today, -1);
  const oldest = addDays(today, -REPORT_311_DAYS);
  const pkg = await options.client.packageShow(BOSTON_311_DATASET);
  const rows: Boston311Row[] = [];
  for (let to = yesterday; to >= oldest; to = addDays(to, -CHUNK_DAYS)) {
    const from = [addDays(to, -(CHUNK_DAYS - 1)), oldest].sort().at(-1)!;
    rows.push(...(await fetch311(options.client, pkg, from, to)));
  }
  const report = report311(rows, { districts: DISTRICTS });
  if (!report || report.city.opened === 0) throw new Error('311: no requests came back for the last month');
  run.rowsWritten += await storeReport311(run.sql, BOSTON_CITY, report);
  run.log('boston-311', { from: report.from, to: report.to, opened: report.city.opened, changed: run.rowsWritten });
  return {};
}
