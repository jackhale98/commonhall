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
  { key: 'committees', label: 'Committees', path: 'boston/committees/' },
  { key: 'neighborhoods', label: 'Neighborhoods', path: 'boston/neighborhoods/' },
  { key: 'budget', label: 'Budget', path: 'boston/budget/' },
] as const;
export type BostonTab = (typeof BOSTON_TABS)[number]['key'];

/** A council meeting with its committees ([] for a full council meeting) and the dockets on its agenda. */
export interface BostonHearing {
  id: string;
  date: string;
  time: string | null;
  starts_at: string | null;
  location: string | null;
  agenda_url: string | null;
  minutes_url: string | null;
  legistar_url: string | null;
  committees: string[];
  /** `stored`: we hold the matter (link our page); otherwise link Legistar. */
  items: { seq: number; matter_id: string | null; file_number: string | null; title: string; stored?: boolean }[];
}

/**
 * A hearing agenda line without its procedural lead-in. Legistar files what a
 * committee heard as "On the message and order, referred on September 30, 2026,
 * Docket #1829, to reduce the FY27 appropriation…" or "Councilor Weber called
 * Docket #1311, message and order authorizing…"; keep what the docket is about.
 */
export function docketTitle(title: string): string {
  const rest = title
    .replace(/^on the [^,]*?,\s*referred on [^,]+,\s*\d{4},\s*docket #\s*\d+,?\s*/i, '')
    .replace(/^councilor [^,]*? called docket #\s*\d+,?\s*/i, '')
    .trim();
  if (!rest) return title;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

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

/** The stages a capital project moves through, in order. */
export const CAPITAL_STAGES = ['Planned', 'Study', 'Design', 'Construction', 'Complete'] as const;

/**
 * Where a project stands among CAPITAL_STAGES (0–4), from the city's status; null
 * for annual programs (recurring work with no stages) and statuses not known here.
 */
export function capitalStage(status: string | null): number | null {
  const s = (status ?? '').toLowerCase();
  if (/new project|to be scheduled/.test(s)) return 0;
  if (/study/.test(s)) return 1;
  if (/design/.test(s)) return 2;
  if (/construction|implementation/.test(s)) return 3;
  if (/complete/.test(s)) return 4;
  return null;
}

/** "FY25" for the plan's first year plus `offset` (first_year 2027 → offset −2 is FY25). */
export const planYear = (firstYear: number | null, offset: number) =>
  firstYear ? `FY${String(firstYear + offset).slice(2)}` : null;

/**
 * The plan's money for one project, in time order. Per the city's data dictionary:
 * "Expended" is actual spending before Year 0 (through FY25 in the FY27–31 plan),
 * Year 0 is the budget for the year before the plan (FY26), Year 1 the plan's first
 * year, Years 2–5 the rest; External Funds are grants not run through the city's
 * capital fund. Together they add up to the project's total budget (checked for
 * every project in the FY27–31 file); any difference shows as its own segment.
 * A few amounts in the city's file are negative (reductions); they are kept, except
 * leftovers under $1,000 (one project lists −$1), which are rounding in the city's file.
 */
export function fundingSegments(p: CapitalProject) {
  const fy = (offset: number) => planYear(p.first_year, offset);
  const segments = [
    { key: 'spent', label: `Spent through ${fy(-2) ?? 'last year'}`, value: p.spent, tone: 'fund-1' },
    { key: 'year0', label: `Budgeted for ${fy(-1) ?? 'last year'}`, value: p.year0, tone: 'fund-2' },
    { key: 'year1', label: `Planned for ${fy(0) ?? 'this year'}`, value: p.year1, tone: 'fund-3' },
    {
      key: 'later',
      label: `Planned for ${fy(1) && fy(4) ? `${fy(1)}–${fy(4)}` : 'later years'}`,
      value: p.years_2_5,
      tone: 'fund-4',
    },
    {
      key: 'external',
      label: 'Outside grants (not through the city’s capital fund)',
      value: p.external_funds,
      tone: 'fund-rest',
    },
  ];
  const listed = segments.reduce((n, s) => n + s.value, 0);
  const other = p.total_budget - listed;
  if (Math.abs(other) >= 1)
    segments.push({ key: 'other', label: 'Not broken down by the city', value: other, tone: 'fund-rest' });
  return segments.filter((s) => s.value > 0 || s.value <= -1000);
}

/** "spent through FY25" for a plan whose first year is `firstYear`. */
export const spentLabel = (firstYear: number | null) => `spent through ${planYear(firstYear, -2) ?? 'last year'}`;

/** Compact project row for the projects explorer (boston/capital.json). */
export interface CapitalRow {
  i: string;
  n: string;
  /** Department, neighbourhood, status, scope. */
  d: string | null;
  h: string | null;
  s: string | null;
  w: string | null;
  /** Total budget, planned spending in the plan's first year, and spent so far. */
  t: number;
  y: number;
  p: number;
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
  p: Number(p.spent),
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

/** A Boston operating or revenue budget line for one year (city_budget_lines). */
export interface CityBudgetLine {
  kind: 'expense' | 'revenue';
  dept: string;
  grouping: string;
  line: string;
  fiscal_year: number;
  basis: 'actual' | 'appropriation' | 'budget';
  amount: number;
}

export const CITY_BUDGET_COLUMNS = 'kind,dept,grouping,line,fiscal_year,basis,amount';

export interface BudgetSummary {
  /** The newest adopted budget year, e.g. 2027, and the year before. */
  year: number;
  prevYear: number;
  total: number;
  /** The year before as appropriated (amended), for the change. */
  prevTotal: number;
  revenueTotal: number;
  /** Revenue categories (Property Tax, State Aid, …), largest first. */
  revenue: { label: string; value: number }[];
  /** Departments, largest first, with the year before. */
  departments: { label: string; value: number; prev: number }[];
}

/** The newest adopted operating budget, its revenue and its departments. */
export function budgetSummary(lines: CityBudgetLine[]): BudgetSummary | null {
  const year = Math.max(...lines.filter((l) => l.kind === 'expense' && l.basis === 'budget').map((l) => l.fiscal_year));
  if (!Number.isFinite(year)) return null;
  const prevYear = year - 1;
  const sumBy = (list: CityBudgetLine[], key: 'dept' | 'grouping') => {
    const m = new Map<string, number>();
    for (const l of list) m.set(l[key] || 'Other', (m.get(l[key] || 'Other') ?? 0) + Number(l.amount));
    return m;
  };
  const spend = lines.filter((l) => l.kind === 'expense' && l.fiscal_year === year && l.basis === 'budget');
  const prevSpend = lines.filter((l) => l.kind === 'expense' && l.fiscal_year === prevYear && l.basis !== 'actual');
  const income = lines.filter((l) => l.kind === 'revenue' && l.fiscal_year === year && l.basis === 'budget');
  const prevByDept = sumBy(prevSpend, 'dept');
  const total = (list: CityBudgetLine[]) => list.reduce((n, l) => n + Number(l.amount), 0);
  return {
    year,
    prevYear,
    total: total(spend),
    prevTotal: total(prevSpend),
    revenueTotal: total(income),
    revenue: [...sumBy(income, 'grouping')]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    departments: [...sumBy(spend, 'dept')]
      .map(([label, value]) => ({ label, value, prev: prevByDept.get(label) ?? 0 }))
      .sort((a, b) => b.value - a.value),
  };
}

/** "+3.9%" / "−0.6%" / "new" for a department's change on the year before. */
export function budgetChange(value: number, prev: number): string {
  if (prev <= 0) return value > 0 ? 'new' : '';
  const pct = ((value - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) return 'no change';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
}
