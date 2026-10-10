/** Worcester's pages: tabs, and the shapes of its council and budget data. */

export const WORCESTER_TABS = [
  { key: 'overview', label: 'Overview', path: 'worcester/' },
  { key: 'council', label: 'Council', path: 'worcester/council/' },
  { key: 'committees', label: 'Committees', path: 'worcester/committees/' },
  { key: 'budget', label: 'Budget', path: 'worcester/budget/' },
] as const;
export type WorcesterTab = (typeof WORCESTER_TABS)[number]['key'];

export interface CityCommittee {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  url: string | null;
  members: { seq: number; official_id: string | null; name: string; role: string | null }[];
}

export interface CityMeeting {
  id: string;
  date: string;
  time: string | null;
  location: string | null;
  agenda_url: string | null;
  minutes_url: string | null;
  legistar_url: string | null;
  status: string | null;
  committees: string[];
}

export const CAPITAL_AMOUNTS = ['borrowing', 'cash', 'new_authorization', 'prior_authorization', 'grants'] as const;

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

/** What a project spends this year: borrowing plus cash. */
export const yearSpend = (i: Pick<CapitalItem, 'borrowing' | 'cash'>) => i.borrowing + i.cash;

/** Departments by this year's spending, largest first. */
export function spendByDepartment(items: CapitalItem[]): { department: string; amount: number; projects: number }[] {
  const by = new Map<string, { amount: number; projects: number }>();
  for (const i of items) {
    // "Public Works - Sewer" and "Public Works - Water" stay apart: they are separate enterprise funds.
    const row = by.get(i.department) ?? { amount: 0, projects: 0 };
    row.amount += yearSpend(i);
    row.projects += 1;
    by.set(i.department, row);
  }
  return [...by]
    .map(([department, r]) => ({ department, ...r }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/** The plan's yearly totals across every area and department. */
export function planTotals(doc: Pick<CapitalDocument, 'plan' | 'plan_years'>): { year: number; amount: number }[] {
  const years = doc.plan_years ?? [];
  return years.map((year, k) => ({
    year,
    amount: (doc.plan ?? []).reduce((n, r) => n + (r.amounts[k] ?? 0), 0),
  }));
}
