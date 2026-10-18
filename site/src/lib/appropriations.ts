/**
 * The federal government's annual funding, from bills we already hold: the twelve
 * regular appropriations bills for a fiscal year (one per Appropriations subcommittee),
 * packages that combine several, and continuing resolutions (stopgaps). Bills are
 * recognised by their titles ("Defense Appropriations Act, 2027", "Making continuing
 * appropriations for fiscal year 2027"); a package's subcommittees by the CRS summary,
 * which names each division. Nothing here is estimated: stages are Congress.gov's.
 */

export interface Subcommittee {
  key: string;
  label: string;
  /** Matches the subcommittee's bill title (or a package's CRS summary). */
  pattern: RegExp;
}

/** The twelve Appropriations subcommittees, each with its own annual bill. */
export const SUBCOMMITTEES: Subcommittee[] = [
  { key: 'agriculture', label: 'Agriculture and FDA', pattern: /\bagricultur/i },
  { key: 'cjs', label: 'Commerce, Justice, Science', pattern: /commerce, justice,? (and )?science/i },
  { key: 'defense', label: 'Defense', pattern: /department of defense|\bdefense appropriations/i },
  { key: 'energy-water', label: 'Energy and Water', pattern: /energy and water/i },
  {
    key: 'fsgg',
    label: 'Financial Services and General Government',
    pattern: /financial services and general government/i,
  },
  { key: 'homeland', label: 'Homeland Security', pattern: /homeland security/i },
  { key: 'interior', label: 'Interior and Environment', pattern: /interior,? (and )?environment/i },
  {
    key: 'labor-hhs',
    label: 'Labor, Health and Human Services, Education',
    pattern: /labor, health and human services/i,
  },
  { key: 'legislative', label: 'Legislative Branch', pattern: /legislative branch/i },
  {
    key: 'milcon-va',
    label: 'Military Construction and Veterans Affairs',
    pattern: /military construction/i,
  },
  {
    key: 'state',
    label: 'State and Foreign Operations',
    pattern: /state, foreign operations|national security, department of state/i,
  },
  {
    key: 'thud',
    label: 'Transportation, Housing and Urban Development',
    pattern: /transportation, housing,? and urban development/i,
  },
];

export interface FundingBill {
  id: string;
  congress: number;
  bill_type: string;
  number: number;
  title: string;
  short_title: string | null;
  status: string;
  latest_action_date: string | null;
  latest_action_text: string | null;
  /** CRS summary, read for stopgaps (their end date) and packages (their divisions). */
  summary_text?: string | null;
  law_number?: string | null;
}

export type FundingKind = 'regular' | 'package' | 'continuing';

/** How far a bill has got: Congress.gov's status, with "reported" for a bill a committee sent to the floor. */
export type FundingStage =
  'introduced' | 'reported' | 'passed_house' | 'passed_senate' | 'passed_both' | 'to_president' | 'vetoed' | 'law';

const RANK: Record<FundingStage, number> = {
  introduced: 0,
  reported: 1,
  passed_house: 2,
  passed_senate: 2,
  passed_both: 3,
  vetoed: 4,
  to_president: 4,
  law: 5,
};

export const STAGE_LABELS: Record<FundingStage, string> = {
  introduced: 'Introduced',
  reported: 'Reported by committee',
  passed_house: 'Passed House',
  passed_senate: 'Passed Senate',
  passed_both: 'Passed Congress',
  to_president: 'To President',
  vetoed: 'Vetoed',
  law: 'Became law',
};

/** The federal fiscal year a date falls in: FY2027 runs October 1, 2026 to September 30, 2027. */
export function fiscalYear(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return m! >= 10 ? y! + 1 : y!;
}

/**
 * The fiscal years worth showing on a date: the one under way, and from April the next
 * one too, whose bills the committees write over the spring and summer.
 */
export function trackedYears(today: string): number[] {
  const fy = fiscalYear(today);
  const month = Number(today.slice(5, 7));
  return month >= 4 && month <= 9 ? [fy, fy + 1] : [fy];
}

const titleOf = (b: Pick<FundingBill, 'title' | 'short_title'>) => b.short_title?.trim() || b.title;

/** A funding bill's kind and fiscal year, or null for any other bill. */
export function classify(b: Pick<FundingBill, 'bill_type' | 'title' | 'short_title'>): {
  kind: FundingKind;
  year: number;
} | null {
  if (!['hr', 's', 'hjres', 'sjres'].includes(b.bill_type)) return null;
  const titles = `${b.short_title ?? ''} | ${b.title}`;
  if (!/appropriations/i.test(titles) || /supplemental|advance appropriations|authoriz/i.test(titles)) return null;
  const year = Number(
    /appropriations act,? (\d{4})\b/i.exec(titles)?.[1] ??
      /fiscal year ending september 30, (\d{4})/i.exec(titles)?.[1] ??
      /appropriations for (?:the )?fiscal year (\d{4})/i.exec(titles)?.[1],
  );
  if (!Number.isInteger(year)) return null;
  if (/continuing appropriations/i.test(titles)) return { kind: 'continuing', year };
  if (/consolidated appropriations|omnibus/i.test(titles)) return { kind: 'package', year };
  const subs = SUBCOMMITTEES.filter((s) => s.pattern.test(titleOf(b)));
  if (subs.length === 0) return null;
  return { kind: subs.length > 1 ? 'package' : 'regular', year };
}

export function stageOf(b: Pick<FundingBill, 'status' | 'latest_action_text'>): FundingStage {
  if (b.status in RANK && b.status !== 'introduced') return b.status as FundingStage;
  if (b.status === 'in_committee' || b.status === 'introduced') {
    // A bill placed on the floor calendar has been reported by its committee.
    if (
      /placed on (the )?(union|senate legislative) calendar|reported (by|to|with|without)/i.test(
        b.latest_action_text ?? '',
      )
    )
      return 'reported';
  }
  return 'introduced';
}

/** Which subcommittees a bill funds: by its title, or for a package by the divisions in its summary. */
export function subcommitteesOf(b: FundingBill, kind: FundingKind): string[] {
  const text = kind === 'package' ? `${titleOf(b)} ${(b.summary_text ?? '').slice(0, 4000)}` : titleOf(b);
  return SUBCOMMITTEES.filter((s) => s.pattern.test(text)).map((s) => s.key);
}

/** "through the earlier of December 4, 2026, or …" in a stopgap's summary → 2026-12-04. */
export function stopgapEnd(summary: string | null | undefined): string | null {
  const m = /through (?:the earlier of )?([A-Z][a-z]+) (\d{1,2}), (\d{4})/.exec(summary ?? '');
  if (!m) return null;
  const month = new Date(`${m[1]} 1, 2000`).getMonth();
  if (Number.isNaN(month)) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}

export interface FundingRow {
  sub: Subcommittee;
  house: (FundingBill & { stage: FundingStage }) | null;
  senate: (FundingBill & { stage: FundingStage }) | null;
  /** The law that funds it for the year, if any (its own bill or a package). */
  law: FundingBill | null;
}

export interface FundingYear {
  year: number;
  rows: FundingRow[];
  enacted: number;
  passedHouse: number;
  passedSenate: number;
  packages: (FundingBill & { stage: FundingStage; covers: string[] })[];
  stopgaps: (FundingBill & { stage: FundingStage; end: string | null })[];
  /** The newest stopgap signed into law and the date it funds the government to. */
  activeStopgap: (FundingBill & { end: string | null }) | null;
}

const furthest = <T extends { stage: FundingStage; latest_action_date: string | null }>(list: T[]) =>
  [...list].sort(
    (a, b) => RANK[b.stage] - RANK[a.stage] || (b.latest_action_date ?? '').localeCompare(a.latest_action_date ?? ''),
  )[0] ?? null;

const passed = (stage: FundingStage | undefined, chamber: 'house' | 'senate') =>
  !!stage &&
  (stage === 'passed_both' ||
    stage === 'to_president' ||
    stage === 'vetoed' ||
    stage === 'law' ||
    stage === (chamber === 'house' ? 'passed_house' : 'passed_senate'));

/** A fiscal year's funding bills, laid out by subcommittee. */
export function fundingYear(bills: FundingBill[], year: number): FundingYear {
  const mine = bills.map((b) => ({ ...b, c: classify(b), stage: stageOf(b) })).filter((b) => b.c?.year === year);
  const regular = mine.filter((b) => b.c!.kind === 'regular');
  const packages = mine
    .filter((b) => b.c!.kind === 'package')
    .map(({ c, ...b }) => ({ ...b, covers: subcommitteesOf(b, c!.kind) }));
  const stopgaps = mine
    .filter((b) => b.c!.kind === 'continuing')
    .map(({ c: _c, ...b }) => ({ ...b, end: stopgapEnd(b.summary_text) }))
    .sort((a, b) => (b.latest_action_date ?? '').localeCompare(a.latest_action_date ?? ''));
  const rows = SUBCOMMITTEES.map((sub) => {
    const own = regular.filter((b) => sub.pattern.test(titleOf(b)));
    const inPackages = packages.filter((p) => p.covers.includes(sub.key));
    const both = [...own, ...inPackages];
    const house = furthest(both.filter((b) => b.bill_type.startsWith('h')));
    const senate = furthest(both.filter((b) => b.bill_type.startsWith('s')));
    const law = both.find((b) => b.stage === 'law') ?? null;
    return { sub, house, senate, law };
  });
  const activeStopgap = stopgaps.find((s) => s.stage === 'law') ?? null;
  return {
    year,
    rows,
    enacted: rows.filter((r) => r.law).length,
    passedHouse: rows.filter((r) => passed(r.house?.stage, 'house') || passed(r.senate?.stage, 'house')).length,
    passedSenate: rows.filter((r) => passed(r.senate?.stage, 'senate') || passed(r.house?.stage, 'senate')).length,
    packages,
    stopgaps,
    activeStopgap,
  };
}
