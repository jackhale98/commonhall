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

/** A Zoning Board of Appeal case (zba_appeals). */
export interface ZbaAppeal {
  boa_apno: string;
  address: string | null;
  neighborhood: string | null;
  ward: string | null;
  appeal_type: string | null;
  status: string | null;
  description: string | null;
  hearing_date: string | null;
  decision: string | null;
  final_decision_date: string | null;
}

export const ZBA_COLUMNS =
  'boa_apno,address,neighborhood,ward,appeal_type,status,description,hearing_date,decision,final_decision_date';

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
  d: string | null;
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
  d: z.decision,
});
