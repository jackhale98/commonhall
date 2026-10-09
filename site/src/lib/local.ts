/**
 * Council matter types hidden from lists by default: consent-agenda resolutions
 * are mostly congratulations and commendations (about 70% of Boston's matters).
 * A toggle shows them, and choosing the type explicitly always does.
 */
export const HIDDEN_MATTER_TYPES = ['Consent Agenda Resolution'];

/** PostgREST filter value excluding the hidden types, e.g. not.in.("Consent Agenda Resolution"). */
export const hiddenTypesFilter = () => `not.in.(${HIDDEN_MATTER_TYPES.map((t) => `"${t}"`).join(',')})`;

/** Boston's sub-pages, in tab order. */
export const BOSTON_TABS = [
  { key: 'overview', label: 'Overview', path: 'boston/' },
  { key: 'council', label: 'Council', path: 'boston/council/' },
  { key: 'neighborhoods', label: 'Neighborhoods', path: 'boston/neighborhoods/' },
  { key: 'budget', label: 'Budget', path: 'boston/budget/' },
] as const;
export type BostonTab = (typeof BOSTON_TABS)[number]['key'];

/** A Boston Capital Plan project (capital_projects). Money in dollars. */
export interface CapitalProject {
  proj_id: string;
  plan: string;
  first_year: number | null;
  department: string | null;
  name: string;
  scope: string | null;
  status: string | null;
  neighborhood: string | null;
  total_budget: number;
  spent: number;
  year0: number;
  year1: number;
  years_2_5: number;
  external_funds: number;
}

export const CAPITAL_COLUMNS =
  'proj_id,plan,first_year,department,name,scope,status,neighborhood,total_budget,spent,year0,year1,years_2_5,external_funds';

/** Compact project row for the projects explorer (boston/capital.json). */
export interface CapitalRow {
  i: string;
  n: string;
  /** Department, neighbourhood, status, scope. */
  d: string | null;
  h: string | null;
  s: string | null;
  w: string | null;
  /** Total budget and planned spending in the plan's first year. */
  t: number;
  y: number;
}

export const capitalRow = (p: CapitalProject): CapitalRow => ({
  i: p.proj_id,
  n: p.name,
  d: p.department,
  h: p.neighborhood,
  s: p.status,
  w: p.scope,
  t: Number(p.total_budget),
  y: Number(p.year1),
});

/** A Zoning Board of Appeal case with a hearing still to come (zba_appeals). */
export interface ZbaAppeal {
  boa_apno: string;
  address: string | null;
  neighborhood: string | null;
  ward: string | null;
  appeal_type: string | null;
  status: string | null;
  description: string | null;
  hearing_date: string | null;
}

export const ZBA_COLUMNS = 'boa_apno,address,neighborhood,ward,appeal_type,status,description,hearing_date';

/** Zoning decisions in the last year, per neighborhood and outcome (zba_decision_counts). */
export interface ZbaDecisionCount {
  neighborhood: string;
  decision: string;
  cases: number;
}

/** Compact case for the zoning explorer (boston/zoning.json). */
export interface ZbaRow {
  i: string;
  a: string | null;
  n: string | null;
  t: string | null;
  s: string | null;
  /** Description, trimmed. */
  w: string | null;
  h: string | null;
}

/** "68 Theodore Parker RD West Roxbury 02132" → "68 Theodore Parker Rd": the neighborhood is shown beside it. */
export function streetAddress(address: string | null, neighborhood: string | null): string | null {
  if (!address) return null;
  let a = address.replace(/\s+\d{5}(-\d{4})?$/, '');
  if (neighborhood && a.toLowerCase().endsWith(` ${neighborhood.toLowerCase()}`))
    a = a.slice(0, -neighborhood.length - 1);
  return a.replace(
    /\b(RD|ST|AV|AVE|PL|TER|CT|LN|DR|SQ|PK|WY|BLVD|HWY|PKWY|CIR|ROW|WHF)\b/g,
    (w) => w[0] + w.slice(1).toLowerCase(),
  );
}

export const zbaRow = (z: ZbaAppeal): ZbaRow => ({
  i: z.boa_apno,
  a: streetAddress(z.address, z.neighborhood),
  n: z.neighborhood,
  t: z.appeal_type,
  s: z.status,
  w: z.description && z.description.length > 240 ? `${z.description.slice(0, 237).trimEnd()}…` : z.description,
  h: z.hearing_date,
});

/** A 311 summary row (boston_311_daily): counts for one day, district, type and system. */
export interface Boston311Day {
  day: string;
  district: number;
  request_type: string;
  source: string;
  opened: number;
  closed: number;
  closed_on_time: number;
  median_close_hours: number | null;
}

export const BOSTON_311_COLUMNS = 'day,district,request_type,source,opened,closed,closed_on_time,median_close_hours';

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
  /** Keyed by council district 1–9. */
  districts: Record<number, Summary311>;
}

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

function summarize(rows: Boston311Day[], from: string, to: string, before: string, top: number): Summary311 {
  const now = rows.filter((r) => r.day >= from && r.day <= to);
  const types = new Map<string, number>();
  for (const r of now) types.set(r.request_type, (types.get(r.request_type) ?? 0) + r.opened);
  return {
    opened: now.reduce((n, r) => n + r.opened, 0),
    openedBefore: rows.filter((r) => r.day >= before && r.day < from).reduce((n, r) => n + r.opened, 0),
    closed: now.reduce((n, r) => n + r.closed, 0),
    closedOnTime: now.reduce((n, r) => n + r.closed_on_time, 0),
    typicalHours: weightedMedian(
      now.filter((r) => r.median_close_hours !== null).map((r) => ({ value: r.median_close_hours!, weight: r.closed })),
    ),
    top: [...types]
      .map(([type, n]) => ({ type, n }))
      .sort((a, b) => b.n - a.n || a.type.localeCompare(b.type))
      .slice(0, top),
  };
}

/**
 * The last 30 days both systems have published (the legacy one runs a day behind),
 * citywide and per district, against the 30 days before.
 */
export function report311(rows: Boston311Day[], top = 8): Report311 | null {
  const lastDays = ['new', 'legacy']
    .map((s) => rows.filter((r) => r.source === s).reduce((m, r) => (r.day > m ? r.day : m), ''))
    .filter(Boolean);
  if (lastDays.length === 0) return null;
  const to = lastDays.sort()[0]!;
  const from = shiftDay(to, -29);
  const before = shiftDay(from, -30);
  const districts: Record<number, Summary311> = {};
  for (let d = 1; d <= 9; d++)
    districts[d] = summarize(
      rows.filter((r) => r.district === d),
      from,
      to,
      before,
      top,
    );
  return { from, to, city: summarize(rows, from, to, before, top), districts };
}

/** "about 5 hours", "about 3 days". */
export function closeTime(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return 'under an hour';
  if (hours < 36) return `${Math.round(hours)} ${Math.round(hours) === 1 ? 'hour' : 'hours'}`;
  return `${Math.round(hours / 24)} days`;
}

/** "+12%" / "−8%" against the 30 days before, or null when there is nothing to compare. */
export function change311(s: Summary311): string | null {
  if (s.openedBefore === 0) return null;
  const pct = Math.round(((s.opened - s.openedBefore) / s.openedBefore) * 100);
  return pct === 0 ? 'same as' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% vs`;
}
