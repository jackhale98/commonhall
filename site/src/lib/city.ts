/**
 * Shapes every city's pages share, whatever the source. Each city's data comes in
 * its own form (Boston's operating budget is line-item data, Worcester's a printed
 * summary; Boston's capital plan has stages and totals, Worcester's capital budget
 * is a year's lines); the loaders turn each into these, and the pages only see these.
 */
import { capitalStage, fundingSegments, spentLabel, type BudgetSummary, type CapitalProject } from './local';

export interface CityMeeting {
  id: string;
  date: string;
  time: string | null;
  starts_at: string | null;
  location: string | null;
  agenda_url: string | null;
  minutes_url: string | null;
  legistar_url: string | null;
  status: string | null;
  /** Committees holding it; empty for a full council meeting. */
  committees: string[];
  /** Dockets on the agenda, where the city records them. `stored`: we hold the matter. */
  items: { seq: number; matter_id: string | null; file_number: string | null; title: string; stored?: boolean }[];
}

export interface CityCommittee {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  url: string | null;
  members: { seq: number; official_id: string | null; name: string; role: string | null }[];
}

export interface OperatingSummary {
  fiscalYear: number;
  stage: 'proposed' | 'adopted';
  /** What the comparison column is called ("FY26", "FY26 Budget"). */
  prevLabel: string;
  total: number;
  prev: number;
  revenueTotal: number;
  revenue: { label: string; value: number }[];
  spending: { label: string; value: number; prev: number; group?: string }[];
  /** "departments" (Boston) or "lines" (Worcester's summary). */
  spendingUnit: string;
  sources: { label: string; url: string }[];
}

/** One capital project, in the form the list, the explorer and its page share. */
export interface ProjectView {
  /** The city-prefixed id: ma-boston-{project id}, ma-worcester-{slug}. */
  id: string;
  title: string;
  department: string | null;
  /** Neighborhood (Boston) or category (Worcester). */
  area: string | null;
  description: string | null;
  /** Boston's stage ("In Construction"), when the city gives one. */
  status: string | null;
  /** Whole-project budget and spending so far, when the city gives them. */
  total: number | null;
  spent: number | null;
  /** This year's money: planned spending (Boston) or borrowing and cash (Worcester). */
  thisYear: number;
  /** Labelled amounts for the project page ("Borrowing", "Grants"…). */
  money: { label: string; value: number }[];
  /** Earlier budgets' figures for the same project, newest first. */
  years: { label: string; spend: number; authorized: number }[];
  /** "spent through FY26", for a whole-project funding bar. */
  spentText?: string;
  segments?: ReturnType<typeof fundingSegments>;
}

export interface CapitalView {
  /** A multi-year plan (Boston) or a year's budget (Worcester). */
  kind: 'plan' | 'budget';
  /** "Capital Plan, FY27–31", "Capital budget, FY27". */
  title: string;
  /** "FY27–31 Capital Plan", "FY27 capital budget". */
  name: string;
  stage: 'proposed' | 'adopted';
  /** "FY27". */
  yearLabel: string;
  /** What `area` is: "Neighborhood" (Boston) or "Category" (Worcester). */
  areaLabel: string;
  projects: ProjectView[];
  /** The plan's yearly totals, when printed. */
  planYears: { label: string; value: number }[];
  sources: { label: string; url: string }[];
  /** Boston only: the source rows for the stage and neighborhood charts. */
  boston?: CapitalProject[];
}

/** Compact explorer row (capital.json): id, title, description, department, area, status, total, spent, this year. */
export interface ProjectRow {
  i: string;
  n: string;
  w: string | null;
  d: string | null;
  h: string | null;
  s: string | null;
  t: number | null;
  p: number | null;
  y: number;
}

export const projectRow = (p: ProjectView): ProjectRow => ({
  i: p.id,
  n: p.title,
  w: p.description,
  d: p.department,
  h: p.area,
  s: p.status,
  t: p.total,
  p: p.spent,
  y: p.thisYear,
});

const fy = (y: number) => `FY${String(y).slice(2)}`;

/** Boston's Capital Plan (Analyze Boston) as the shared view. */
export function bostonCapital(projects: CapitalProject[], cityKey: string): CapitalView | null {
  if (!projects.length) return null;
  const first = projects[0]!;
  const yearLabel = first.first_year ? fy(first.first_year) : 'this year';
  const spentText = spentLabel(first.first_year ?? null);
  return {
    kind: 'plan',
    title: `Capital Plan, ${first.plan.replace('-', '–')}`,
    name: `${first.plan.replace('-', '–')} Capital Plan`,
    stage: 'adopted',
    yearLabel,
    areaLabel: 'Neighborhood',
    planYears: [],
    sources: [
      { label: `${first.plan.replace('-', '–')} Capital Plan`, url: 'https://data.boston.gov/dataset/capital-budget' },
    ],
    boston: projects,
    projects: projects.map((p) => ({
      id: `${cityKey}-${p.proj_id}`,
      title: p.name,
      department: p.department,
      area: p.neighborhood,
      description: p.scope,
      status: p.status,
      total: p.total_budget,
      spent: p.spent,
      thisYear: p.year1,
      money: [
        { label: `Planned in ${yearLabel}`, value: p.year1 },
        { label: 'Planned later in the plan', value: p.years_2_5 },
        { label: 'Outside funds', value: p.external_funds },
      ].filter((m) => m.value > 0),
      years: [],
      spentText,
      segments: fundingSegments(p),
    })),
  };
}

/** Boston's operating and revenue budgets (line-item data) as the shared summary. */
export function bostonOperating(b: BudgetSummary | null): OperatingSummary | null {
  if (!b) return null;
  return {
    fiscalYear: b.year,
    stage: 'adopted',
    prevLabel: fy(b.prevYear),
    total: b.total,
    prev: b.prevTotal,
    revenueTotal: b.revenueTotal,
    revenue: b.revenue,
    spending: b.departments,
    spendingUnit: 'departments',
    sources: [
      { label: 'operating budget', url: 'https://data.boston.gov/dataset/operating-budget' },
      { label: 'revenue budget', url: 'https://data.boston.gov/dataset/revenue-budget' },
    ],
  };
}

/** Under construction or underway (Boston's stage 3 of 0–4). */
export const isBuilding = (p: Pick<ProjectView, 'status'>) => capitalStage(p.status) === 3;

// ---- Annual capital budgets and printed operating summaries (Worcester) -----

/** One line of a year's capital budget (local_capital_items). */
export interface CapitalItem {
  fiscal_year: number;
  stage: 'proposed' | 'adopted';
  seq: number;
  department: string;
  category: string | null;
  title: string;
  description: string | null;
  borrowing: number;
  cash: number;
  new_authorization: number;
  prior_authorization: number;
  grants: number;
}

export interface CapitalDocument {
  fiscal_year: number;
  stage: 'proposed' | 'adopted';
  title: string;
  source_url: string;
  plan_years: number[] | null;
  plan: { area: string; department: string; amounts: number[] }[] | null;
}

/** A budget line's money this year: borrowing plus cash. */
export const yearSpend = (i: Pick<CapitalItem, 'borrowing' | 'cash'>) => i.borrowing + i.cash;

/**
 * A project's id across budgets: its department and title ("public-works-resurfacing"),
 * so a program funded year after year keeps one page and one discussion.
 */
export function projectSlug(i: Pick<CapitalItem, 'department' | 'title'>): string {
  return `${i.department} ${i.title}`
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

/** Annual capital budgets (newest first) as the shared view: the newest budget's projects, with earlier years. */
export function annualCapital(
  budgets: { doc: CapitalDocument; items: CapitalItem[] }[],
  cityKey: string,
): CapitalView | null {
  const current = budgets[0];
  if (!current) return null;
  const label = (d: CapitalDocument) => `${fy(d.fiscal_year)} ${d.stage}`;
  const bySlug = new Map<string, { doc: CapitalDocument; item: CapitalItem }[]>();
  for (const b of budgets)
    for (const item of b.items) {
      const list = bySlug.get(projectSlug(item)) ?? [];
      if (!list.some((x) => x.doc.fiscal_year === b.doc.fiscal_year)) list.push({ doc: b.doc, item });
      bySlug.set(projectSlug(item), list);
    }
  // Every project in any budget we hold gets a page; the list shows the newest budget's.
  const projects: ProjectView[] = [...bySlug].map(([slug, years]) => {
    const { item } = years[0]!;
    return {
      id: `${cityKey}-${slug}`,
      title: item.title,
      department: item.department,
      area: item.category,
      description: years.find((y) => y.item.description)?.item.description ?? null,
      status: null,
      total: null,
      spent: null,
      thisYear: years[0]!.doc.fiscal_year === current.doc.fiscal_year ? yearSpend(item) : 0,
      money: [
        { label: 'Borrowing', value: item.borrowing },
        { label: 'Cash', value: item.cash },
        { label: 'Grants and donations', value: item.grants },
        { label: 'New borrowing approved', value: item.new_authorization },
        { label: 'Approved in earlier years', value: item.prior_authorization },
      ].filter((m) => m.value > 0),
      years: years.map((y) => ({
        label: label(y.doc),
        spend: yearSpend(y.item),
        authorized: y.item.new_authorization,
      })),
    };
  });
  const planYears = (current.doc.plan_years ?? []).map((year, k) => ({
    label: fy(year),
    value: (current.doc.plan ?? []).reduce((n, r) => n + (r.amounts[k] ?? 0), 0),
  }));
  return {
    kind: 'budget',
    title: `Capital budget, ${fy(current.doc.fiscal_year)}`,
    name: `${fy(current.doc.fiscal_year)} capital budget`,
    stage: current.doc.stage,
    yearLabel: fy(current.doc.fiscal_year),
    areaLabel: 'Category',
    projects,
    planYears,
    sources: budgets.map((b) => ({ label: b.doc.title, url: b.doc.source_url })),
  };
}

/** True when a project is in the newest budget (the list shows only those). */
export const inCurrentBudget = (p: ProjectView, view: CapitalView) =>
  view.kind === 'plan' || p.years[0]?.label.startsWith(view.yearLabel) === true;

export interface OperatingLine {
  kind: 'revenue' | 'spending';
  seq: number;
  grp: string;
  label: string;
  amounts: number[];
}

/** A printed revenue and expenditure summary (local_operating_lines) as the shared summary. */
export function printedOperating(
  doc: { fiscal_year: number; stage: 'proposed' | 'adopted'; title: string; source_url: string; columns: string[] },
  lines: OperatingLine[],
): OperatingSummary {
  const last = (l: OperatingLine, back = 1) => l.amounts.at(-back) ?? 0;
  const revenueGroups = new Map<string, number>();
  for (const l of lines.filter((x) => x.kind === 'revenue'))
    revenueGroups.set(l.grp, (revenueGroups.get(l.grp) ?? 0) + last(l));
  const spending = lines
    .filter((l) => l.kind === 'spending')
    .map((l) => ({ label: l.label, value: last(l), prev: last(l, 2), group: l.grp }))
    .sort((a, b) => b.value - a.value);
  return {
    fiscalYear: doc.fiscal_year,
    stage: doc.stage,
    prevLabel: doc.columns.at(-2) ?? 'last year',
    total: spending.reduce((n, l) => n + l.value, 0),
    prev: spending.reduce((n, l) => n + l.prev, 0),
    revenueTotal: [...revenueGroups.values()].reduce((n, v) => n + v, 0),
    revenue: [...revenueGroups]
      .map(([label, value]) => ({ label, value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value),
    spending,
    spendingUnit: 'lines',
    sources: [{ label: doc.title, url: doc.source_url }],
  };
}
