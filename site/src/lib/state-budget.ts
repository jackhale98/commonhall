/**
 * A state's budget for its Budget tab: totals by category and secretariat, how far
 * through the fiscal year spending is, and compact line items for the search. The
 * amounts are the source's own columns (state_budget_lines); nothing is estimated.
 */

/** Short words that stay lower case inside a name. */
const SMALL = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);
/** Three-letter words that are words, not initials. */
const SHORT_WORDS = new Set(
  'act age aid air all art bar bay day end fee gas job lab law low new old one oil pay sea sex tax two use war'.split(
    ' ',
  ),
);
/** Initials with vowels that read as words: kept in capitals. */
const ACRONYMS = new Set(
  'ABCC AIDS ARPA BRAC COVID CORI CPCS CPPI DCAM DESE EOHHS ERIP ESOL FEMA HCBS HCCC HRCMS HVAC IAUPO IBCO IBPO MASAC MBTA MCOFU MDFA MEMA MEPA MLAC MMARS MSBA MTTF NAACP NAGE NCEU NEPBA OCCS OPEB OPEIU PFAS SAEK SEIU SGHTF SNAP SOPS SPOC SRBTF STCC STEM TANF UMASS USA VOCA'.split(
    ' ',
  ),
);

/**
 * A state's capital-letter names in title case, keeping initials as they are:
 * "MBTA STATE AND LOCAL CONTRIBUTION" → "MBTA State and Local Contribution",
 * "DCF FAMILY RESOURCE CENTERS" → "DCF Family Resource Centers". A word is kept in
 * capitals when it has no vowel, is three letters or fewer and not a common word, or
 * is a known acronym. Words already in mixed or lower case are left alone.
 */
export function officialTitle(name: string): string {
  let first = true;
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[A-Za-z]+/g, (word) => {
      const isFirst = first;
      first = false;
      if (word !== word.toUpperCase()) return word;
      const lower = word.toLowerCase();
      if (!isFirst && SMALL.has(lower)) return lower;
      if (
        ACRONYMS.has(word) ||
        !/[AEIOUY]/.test(word) ||
        (word.length <= 3 && !SHORT_WORDS.has(lower) && !SMALL.has(lower))
      )
        return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    });
}

export interface StateBudgetTotal {
  fiscal_year: number;
  cabinet: string;
  category: string;
  accounts: number;
  enacted: number;
  supplemental: number;
  total_enacted: number;
  available: number;
  spent: number;
}

export interface StateBudgetLine {
  account: string;
  account_name: string;
  department: string;
  cabinet: string;
  category: string;
  enacted: number;
  supplemental: number;
  total_enacted: number;
  available: number;
  spent: number;
  /** The fund it's paid from (Connecticut); empty for Massachusetts. */
  fund?: string;
}

/** A line item as budget.json serves it to the search. */
export interface BudgetLineRow {
  /** Account number. */
  a: string;
  n: string;
  d: string;
  c: string;
  k: string;
  /** Total enacted (GAA and supplemental budgets). */
  e: number;
  /** Supplemental budgets. */
  s: number;
  /** Total available for spending. */
  v: number;
  /** Spent so far. */
  x: number;
  /** The fund, where the state has funds (Connecticut). */
  f?: string;
}

export const budgetLineRow = (l: StateBudgetLine): BudgetLineRow => ({
  a: l.account,
  n: officialTitle(l.account_name),
  d: officialTitle(l.department),
  c: officialTitle(l.cabinet),
  k: l.category,
  e: Number(l.total_enacted),
  s: Number(l.supplemental),
  v: Number(l.available),
  x: Number(l.spent),
  ...(l.fund ? { f: l.fund } : {}),
});

export interface BudgetGroup {
  label: string;
  /** Total enacted this year. */
  value: number;
  spent: number;
  /** Total enacted the year before (0 when the group is new). */
  prev: number;
  accounts: number;
}

/** Totals for a year by category or secretariat, largest first, with the year before alongside. */
export function budgetGroups(
  totals: StateBudgetTotal[],
  year: number,
  key: 'category' | 'cabinet',
  empty = 'Not classified',
): BudgetGroup[] {
  const groups = new Map<string, BudgetGroup>();
  for (const t of totals) {
    if (t.fiscal_year !== year && t.fiscal_year !== year - 1) continue;
    const label = (key === 'cabinet' ? officialTitle(t.cabinet) : t.category) || empty;
    const g = groups.get(label) ?? { label, value: 0, spent: 0, prev: 0, accounts: 0 };
    if (t.fiscal_year === year) {
      g.value += Number(t.total_enacted);
      g.spent += Number(t.spent);
      g.accounts += t.accounts;
    } else g.prev += Number(t.total_enacted);
    groups.set(label, g);
  }
  return [...groups.values()].filter((g) => g.value > 0).sort((a, b) => b.value - a.value);
}

/** One year's sums across every account. */
export function budgetYear(totals: StateBudgetTotal[], year: number) {
  const rows = totals.filter((t) => t.fiscal_year === year);
  const sum = (f: (t: StateBudgetTotal) => number) => rows.reduce((n, t) => n + Number(f(t)), 0);
  return {
    enacted: sum((t) => t.enacted),
    supplemental: sum((t) => t.supplemental),
    total_enacted: sum((t) => t.total_enacted),
    available: sum((t) => t.available),
    spent: sum((t) => t.spent),
    accounts: sum((t) => t.accounts),
  };
}

/**
 * How much of a fiscal year has passed on a date, 0 to 1. Massachusetts' and
 * Connecticut's years run July 1 to June 30: FY27 is July 1, 2026 – June 30, 2027.
 */
export function yearElapsed(fiscalYear: number, on: Date, startMonth = 7): number {
  const start = Date.UTC(fiscalYear - 1, startMonth - 1, 1);
  const end = Date.UTC(fiscalYear, startMonth - 1, 1);
  return Math.min(1, Math.max(0, (on.getTime() - start) / (end - start)));
}

/** A town's adopted budget for a year, in summary (town_budgets). */
export interface TownBudget {
  town: string;
  fiscal_year: number;
  property_tax: number;
  state_revenue: number;
  federal_revenue: number;
  fund_balance: number;
  other_revenue: number;
  total_revenue: number;
  education: number;
  debt_service: number;
  contingency: number;
  other_spending: number;
  total_spending: number;
  mill_rate: number | null;
  mill_rate_vehicles: number | null;
}

/** Columns the site reads from town_budgets. */
export const TOWN_BUDGET_COLUMNS =
  'town,fiscal_year,property_tax,state_revenue,federal_revenue,fund_balance,other_revenue,total_revenue,education,debt_service,contingency,other_spending,total_spending,mill_rate,mill_rate_vehicles';

/** "GROTON (CITY)" → "Groton (City)", "NEW LONDON" → "New London". */
export const townName = (town: string) =>
  town.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
