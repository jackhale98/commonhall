/**
 * Boston 311 request summaries from Analyze Boston ("311-service-requests"). The
 * city runs two systems with different departments: the NEW SYSTEM table and the
 * legacy table published per year ("311 Service Requests - 2026"). Each run asks
 * both, in SQL on the city's side, for counts per day, council district and request
 * type, so no individual request (or address) is ever read or stored.
 *
 * The first run backfills HISTORY_DAYS a fortnight at a time, saving its place
 * after each chunk; later runs re-read the last REFRESH_DAYS (requests close late)
 * and drop days older than KEEP_DAYS.
 *
 * The portal's firewall refuses some SQL words (substr, extract): use left() and
 * date_part().
 */
import { type AnalyzeBostonClient, type CkanPackage, type CkanResource } from '@civic/congress-client';
import type { Sql } from '../db.ts';
import type { JobRun } from '../job.ts';

export const BOSTON_311_JOB = 'boston-311';
export const BOSTON_311_DATASET = '311-service-requests';
export const HISTORY_DAYS = 90;
export const REFRESH_DAYS = 14;
export const KEEP_DAYS = 120;
const CHUNK_DAYS = 14;

export interface Boston311Cursor {
  [key: string]: unknown;
  /** Oldest day loaded so far (YYYY-MM-DD); the backfill is done once it reaches HISTORY_DAYS back. */
  backfilledFrom?: string;
  /** Newest day loaded; a run after a pause re-reads from here so no days are skipped. */
  loadedTo?: string;
}

export interface Boston311Row extends Record<string, unknown> {
  day: string;
  district: number;
  request_type: string;
  source: 'new' | 'legacy';
  opened: number;
  closed: number;
  closed_on_time: number;
  median_close_hours: number | null;
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

/**
 * Replace the summaries for [from, to] with `rows`, in one transaction. Returns the
 * number of rows inserted, changed or removed (unchanged rows are not rewritten).
 */
export async function store311(sql: Sql, from: string, to: string, rows: Boston311Row[]): Promise<number> {
  return sql.begin(async (tx) => {
    const changed = rows.length
      ? await tx`
        insert into public.boston_311_daily as t
          (day, district, request_type, source, opened, closed, closed_on_time, median_close_hours)
        select day, district, request_type, source, opened, closed, closed_on_time, median_close_hours
        from jsonb_to_recordset(${tx.json(rows as never)}::jsonb) as x(
          day date, district smallint, request_type text, source text,
          opened integer, closed integer, closed_on_time integer, median_close_hours numeric)
        on conflict (day, district, request_type, source) do update set
          opened = excluded.opened, closed = excluded.closed, closed_on_time = excluded.closed_on_time,
          median_close_hours = excluded.median_close_hours, updated_at = now()
        where (t.opened, t.closed, t.closed_on_time, t.median_close_hours)
          is distinct from (excluded.opened, excluded.closed, excluded.closed_on_time, excluded.median_close_hours)
        returning 1`
      : [];
    const keys = rows.map((r) => `${r.day}|${r.district}|${r.request_type}|${r.source}`);
    const gone = await tx`
      delete from public.boston_311_daily
      where day between ${from} and ${to}
        and (day::text || '|' || district || '|' || request_type || '|' || source) <> all(${keys}::text[])
      returning 1`;
    return changed.length + gone.length;
  });
}

export async function syncBoston311(
  run: JobRun<Boston311Cursor>,
  options: { client: AnalyzeBostonClient; now?: () => Date },
): Promise<Boston311Cursor> {
  const today = bostonToday(options.now?.() ?? new Date());
  const yesterday = addDays(today, -1);
  const oldest = addDays(today, -HISTORY_DAYS);
  const pkg = await options.client.packageShow(BOSTON_311_DATASET);
  let cursor = { ...run.cursor };

  // The recent fortnight first (it changes most), then any backfill, oldest-needed last.
  // After a pause, start where the last run stopped (at most 30 days back, one query's worth).
  const refreshFrom = [
    addDays(today, -REFRESH_DAYS),
    cursor.loadedTo ? addDays(cursor.loadedTo, 1) : '9999',
    addDays(today, -30),
  ]
    .sort()
    .slice(0, 2)
    .at(-1)!;
  const recent = await fetch311(options.client, pkg, refreshFrom, yesterday);
  if (recent.length === 0) throw new Error('311: no requests came back for the last two weeks');
  run.rowsWritten += await store311(run.sql, refreshFrom, yesterday, recent);
  cursor.loadedTo = yesterday;
  if (!cursor.backfilledFrom || cursor.backfilledFrom > refreshFrom) cursor.backfilledFrom = refreshFrom;
  await run.checkpoint(cursor);

  while (cursor.backfilledFrom! > oldest && !run.outOfTime()) {
    const to = addDays(cursor.backfilledFrom!, -1);
    const from = [addDays(to, -(CHUNK_DAYS - 1)), oldest].sort().at(-1)!;
    run.rowsWritten += await store311(run.sql, from, to, await fetch311(options.client, pkg, from, to));
    cursor = { ...cursor, backfilledFrom: from };
    await run.checkpoint(cursor);
  }

  if (cursor.backfilledFrom! < oldest) cursor.backfilledFrom = oldest;
  const pruned = await run.sql`
    delete from public.boston_311_daily where day < ${addDays(today, -KEEP_DAYS)} returning 1`;
  run.rowsWritten += pruned.length;
  run.log('boston-311', { backfilledFrom: cursor.backfilledFrom, written: run.rowsWritten });
  return cursor;
}
