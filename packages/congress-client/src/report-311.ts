/**
 * The 311 report a city's pages show: the last 30 days both systems have published,
 * citywide and per council district, against the 30 days before. The sync builds it
 * from daily counts (never individual requests) and stores only the report, one row
 * per city; the site reads that row. Pure, so both sides share it.
 */

/** Counts for one day, district, request type and system, as the city's SQL returns them. */
export interface Day311 {
  day: string;
  /** Council district (1–9 in Boston); 0 when the city did not give one. */
  district: number;
  request_type: string;
  source: string;
  opened: number;
  closed: number;
  closed_on_time: number;
  median_close_hours: number | null;
}

/** 311 over a 30-day window for the whole city or one district. */
export interface Summary311 {
  opened: number;
  /** The 30 days before, for the change. */
  openedBefore: number;
  closed: number;
  closedOnTime: number;
  /** Typical hours to close: the median of each group's median, weighted by how many closed. */
  typicalHours: number | null;
  /** Most requested types, largest first. */
  top: { type: string; n: number }[];
}

export interface Report311 {
  /** First and last day of the window (YYYY-MM-DD). */
  from: string;
  to: string;
  city: Summary311;
  /** Keyed by council district. */
  districts: Record<number, Summary311>;
  /** False when the city sets no target times, so `closedOnTime` means nothing (Somerville). */
  onTime?: false;
}

/** Days of counts a report needs: the window and the 30 days before it, plus slack for the slower system. */
export const REPORT_311_DAYS = 62;

const shiftDay = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function weightedMedian(pairs: { value: number; weight: number }[]): number | null {
  const sorted = pairs.filter((p) => p.weight > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((n, p) => n + p.weight, 0);
  let seen = 0;
  for (const p of sorted) {
    seen += p.weight;
    if (seen >= total / 2) return p.value;
  }
  return null;
}

function summarize(rows: Day311[], from: string, to: string, before: string, top: number): Summary311 {
  const now = rows.filter((r) => r.day >= from && r.day <= to);
  const types = new Map<string, number>();
  for (const r of now) types.set(r.request_type, (types.get(r.request_type) ?? 0) + r.opened);
  const hours = weightedMedian(
    now.filter((r) => r.median_close_hours !== null).map((r) => ({ value: r.median_close_hours!, weight: r.closed })),
  );
  return {
    opened: now.reduce((n, r) => n + r.opened, 0),
    openedBefore: rows.filter((r) => r.day >= before && r.day < from).reduce((n, r) => n + r.opened, 0),
    closed: now.reduce((n, r) => n + r.closed, 0),
    closedOnTime: now.reduce((n, r) => n + r.closed_on_time, 0),
    typicalHours: hours === null ? null : Math.round(hours * 10) / 10,
    top: [...types]
      .map(([type, n]) => ({ type, n }))
      .sort((a, b) => b.n - a.n || a.type.localeCompare(b.type))
      .slice(0, top),
  };
}

/**
 * The report from daily counts: the window ends on the last day every system has
 * published (Boston's legacy one runs a day behind). Null without counts.
 */
export function report311(
  rows: Day311[],
  options: { districts: number; top?: number; onTime?: boolean },
): Report311 | null {
  const top = options.top ?? 8;
  const lastDays = [...new Set(rows.map((r) => r.source))]
    .map((s) => rows.filter((r) => r.source === s).reduce((m, r) => (r.day > m ? r.day : m), ''))
    .filter(Boolean);
  if (lastDays.length === 0) return null;
  const to = lastDays.sort()[0]!;
  const from = shiftDay(to, -29);
  const before = shiftDay(from, -30);
  const districts: Record<number, Summary311> = {};
  for (let d = 1; d <= options.districts; d++)
    districts[d] = summarize(
      rows.filter((r) => r.district === d),
      from,
      to,
      before,
      top,
    );
  const report: Report311 = { from, to, city: summarize(rows, from, to, before, top), districts };
  if (options.onTime === false) report.onTime = false;
  return report;
}
