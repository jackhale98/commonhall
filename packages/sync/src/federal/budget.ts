/**
 * Federal spending: where the money comes from and goes, each agency's budget, and
 * what is awarded in each state and congressional district. Daily (pg_cron,
 * sync-federal-budget), in three parts that stand alone, so one failing (a renamed
 * field) doesn't keep the others from updating:
 *
 * - The Monthly Treasury Statement's Table 9 (Treasury Fiscal Data API): receipts by
 *   source and outlays by function, for the month and the fiscal year to date. Read
 *   only when a new statement is out (about the eighth working day of each month).
 *   Two statements are kept: the newest, and, while a year is under way, the last one
 *   of the year before, so the site can show a whole year beside the one in progress.
 * - Each agency's budget authority, obligations and outlays for the year under way
 *   (USAspending's agency list, one request).
 * - Contracts, grants and other financial assistance by place of performance, per
 *   state and per district (USAspending's geography search, six requests), for the
 *   newest fiscal year that ended at least four months ago, so the agencies' late
 *   reports are in. Refreshed weekly: awards for a closed year still change a little.
 *
 * All amounts are the sources' own, unchanged. About 1,000 rows in all.
 */
import {
  checkKept,
  safeUrl,
  type AwardGroup,
  type FiscalDataClient,
  type GeoLayer,
  type GeographyAmount,
  type MtsLine,
  type ToptierAgency,
  type UsaSpendingClient,
} from '@civic/congress-client';
import type { JobRun } from '../job.ts';

export const FEDERAL_BUDGET_JOB = 'federal-budget';
/** Days between rereads of a year's awards by state and district. */
export const AREA_REFRESH_DAYS = 7;
/** Fewer than these means a broken read, not a smaller government (111 agencies, 56 states and territories, 441 districts). */
export const FEDERAL_MINIMUMS = { agencies: 80, states: 50, districts: 430, mtsLines: 25 };

export interface FederalBudgetCursor {
  [key: string]: unknown;
  /** The newest Monthly Treasury Statement stored ("2026-09-30"). */
  mts?: string;
  /** The fiscal year of awards stored by state and district, and when they were read. */
  areas?: { fiscalYear: number; at: string };
}

const DAY = 86_400_000;

/** The federal fiscal year a date falls in: FY2027 runs October 1, 2026 to September 30, 2027. */
const fiscalYearOf = (date: Date) => (date.getUTCMonth() >= 9 ? date.getUTCFullYear() + 1 : date.getUTCFullYear());

/** The fiscal year whose awards are shown: the newest one that ended at least 120 days before `now`. */
export function areaFiscalYear(now: Date): number {
  return fiscalYearOf(new Date(now.getTime() - 120 * DAY)) - 1;
}

/**
 * The statements to keep for the newest one: September's ends a fiscal year and
 * stands alone; any other month is kept with the September before it.
 */
export function statementDates(latest: string): string[] {
  const [year, month] = latest.split('-').map(Number) as [number, number];
  if (month === 9) return [latest];
  const fy = month >= 10 ? year + 1 : year;
  return [latest, `${fy - 1}-09-30`];
}

export interface MtsRow extends Record<string, unknown> {
  record_date: string;
  line: number;
  section: 'receipts' | 'outlays';
  level: number;
  kind: 'S' | 'D' | 'T';
  label: string;
  month: number | null;
  fytd: number | null;
  prior_fytd: number | null;
}

/** "null" and blanks are no amount; anything else must be a number. */
const amount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || v === 'null') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

/** One line of Table 9 as a stored row, or null when it can't be read. */
export function mtsRow(l: MtsLine): MtsRow | null {
  const line = Number(l.src_line_nbr);
  const level = Number(l.sequence_level_nbr);
  const section = { '1': 'receipts', '2': 'outlays' }[l.sequence_number_cd.split('.')[0] ?? ''] as
    MtsRow['section'] | undefined;
  const kind = l.data_type_cd as MtsRow['kind'];
  if (!Number.isInteger(line) || !Number.isInteger(level) || !section || !['S', 'D', 'T'].includes(kind)) return null;
  const amounts = {
    month: amount(l.current_month_rcpt_outly_amt),
    fytd: amount(l.current_fytd_rcpt_outly_amt),
    prior_fytd: amount(l.prior_fytd_rcpt_outly_amt),
  };
  if (Object.values(amounts).some((n) => Number.isNaN(n))) return null;
  return {
    record_date: l.record_date,
    line,
    section,
    level,
    kind,
    label: l.classification_desc.trim().replace(/:$/, ''),
    ...amounts,
  };
}

/**
 * Throws unless a statement has both totals and its lines add up to them: a moved or
 * missing line would otherwise go unnoticed.
 */
export function checkStatement(date: string, rows: MtsRow[], minLines = FEDERAL_MINIMUMS.mtsLines) {
  if (rows.length < minLines)
    throw new Error(`Monthly Treasury Statement ${date}: ${rows.length} lines (expected at least ${minLines})`);
  for (const section of ['receipts', 'outlays'] as const) {
    const mine = rows.filter((r) => r.section === section);
    const total = mine.find((r) => r.kind === 'T')?.fytd;
    if (total === null || total === undefined)
      throw new Error(`Monthly Treasury Statement ${date}: no ${section} total`);
    const sum = mine.filter((r) => r.kind === 'D').reduce((n, r) => n + (r.fytd ?? 0), 0);
    if (Math.abs(sum - total) > Math.abs(total) * 0.001)
      throw new Error(`Monthly Treasury Statement ${date}: ${section} lines add up to ${sum}, not the total ${total}`);
  }
}

async function syncStatements(run: JobRun<FederalBudgetCursor>, client: FiscalDataClient, cursor: FederalBudgetCursor) {
  const latest = await client.latestMtsDate();
  if (!latest) throw new Error('Monthly Treasury Statement: no statement dates');
  if (cursor.mts === latest) {
    run.log('federal-budget: statement unchanged', { latest });
    return;
  }
  const dates = statementDates(latest);
  const rows: MtsRow[] = [];
  for (const date of dates) {
    const lines = await client.mtsTable9(date);
    const mapped = lines.map(mtsRow);
    checkKept(`Monthly Treasury Statement ${date}`, lines.length, mapped.filter(Boolean).length);
    const kept = mapped.filter((r): r is MtsRow => r !== null);
    checkStatement(date, kept);
    rows.push(...kept);
  }
  run.rowsWritten += await run.sql.begin(async (tx) => {
    const changed = await tx`
      insert into public.federal_mts_lines as t
        (record_date, line, section, level, kind, label, month, fytd, prior_fytd)
      select record_date, line, section, level, kind, label, month, fytd, prior_fytd
        from jsonb_to_recordset(${tx.json(rows as never)}::jsonb) as x(
          record_date date, line smallint, section text, level smallint, kind text, label text,
          month numeric, fytd numeric, prior_fytd numeric)
      on conflict (record_date, line) do update
        set section = excluded.section, level = excluded.level, kind = excluded.kind,
            label = excluded.label, month = excluded.month, fytd = excluded.fytd,
            prior_fytd = excluded.prior_fytd, updated_at = now()
        where (t.section, t.level, t.kind, t.label, t.month, t.fytd, t.prior_fytd)
          is distinct from (excluded.section, excluded.level, excluded.kind, excluded.label,
                            excluded.month, excluded.fytd, excluded.prior_fytd)
      returning 1`;
    const keys = rows.map((r) => `${r.record_date}|${r.line}`);
    const gone = await tx`
      delete from public.federal_mts_lines
       where (record_date::text || '|' || line) <> all(${keys}::text[])
      returning 1`;
    return changed.length + gone.length;
  });
  cursor.mts = latest;
  run.log('federal-budget: statements', { dates, lines: rows.length });
}

export interface AgencyRow extends Record<string, unknown> {
  toptier_code: string;
  name: string;
  abbreviation: string;
  slug: string;
  fiscal_year: number;
  fiscal_quarter: number;
  budget_authority: number;
  obligated: number;
  outlays: number;
  share: number;
  justification_url: string | null;
}

export function agencyRow(a: ToptierAgency): AgencyRow | null {
  const fiscalYear = Number(a.active_fy);
  const quarter = Number(a.active_fq);
  if (!/^\d{3,4}$/.test(a.toptier_code) || !a.agency_name?.trim() || !Number.isInteger(fiscalYear)) return null;
  const money = [a.budget_authority_amount, a.obligated_amount, a.outlay_amount].map((v) => amount(v) ?? 0);
  if (money.some((n) => Number.isNaN(n)) || !Number.isFinite(a.percentage_of_total_budget_authority)) return null;
  return {
    toptier_code: a.toptier_code,
    name: a.agency_name.trim(),
    abbreviation: (a.abbreviation ?? '').trim(),
    slug: /^[a-z0-9-]+$/.test(a.agency_slug ?? '') ? a.agency_slug : '',
    fiscal_year: fiscalYear,
    fiscal_quarter: Number.isInteger(quarter) ? quarter : 0,
    budget_authority: money[0]!,
    obligated: money[1]!,
    outlays: money[2]!,
    share: a.percentage_of_total_budget_authority,
    justification_url: safeUrl(a.congressional_justification_url),
  };
}

async function syncAgencies(run: JobRun<FederalBudgetCursor>, client: UsaSpendingClient, minAgencies: number) {
  const agencies = await client.toptierAgencies();
  const mapped = agencies.map(agencyRow);
  checkKept('USAspending agencies', agencies.length, mapped.filter(Boolean).length);
  const rows = mapped.filter((r): r is AgencyRow => r !== null);
  if (rows.length < minAgencies)
    throw new Error(
      `USAspending agencies: ${rows.length} read (expected at least ${minAgencies}); keeping the stored list`,
    );
  run.rowsWritten += await run.sql.begin(async (tx) => {
    const changed = await tx`
      insert into public.federal_agency_budgets as t
        (toptier_code, name, abbreviation, slug, fiscal_year, fiscal_quarter, budget_authority,
         obligated, outlays, share, justification_url)
      select toptier_code, name, abbreviation, slug, fiscal_year, fiscal_quarter, budget_authority,
             obligated, outlays, share, justification_url
        from jsonb_to_recordset(${tx.json(rows as never)}::jsonb) as x(
          toptier_code text, name text, abbreviation text, slug text, fiscal_year smallint,
          fiscal_quarter smallint, budget_authority numeric, obligated numeric, outlays numeric,
          share numeric, justification_url text)
      on conflict (toptier_code) do update
        set name = excluded.name, abbreviation = excluded.abbreviation, slug = excluded.slug,
            fiscal_year = excluded.fiscal_year, fiscal_quarter = excluded.fiscal_quarter,
            budget_authority = excluded.budget_authority, obligated = excluded.obligated,
            outlays = excluded.outlays, share = excluded.share,
            justification_url = excluded.justification_url, updated_at = now()
        where (t.name, t.abbreviation, t.slug, t.fiscal_year, t.fiscal_quarter, t.budget_authority,
               t.obligated, t.outlays, t.share, t.justification_url)
          is distinct from (excluded.name, excluded.abbreviation, excluded.slug, excluded.fiscal_year,
               excluded.fiscal_quarter, excluded.budget_authority, excluded.obligated, excluded.outlays,
               excluded.share, excluded.justification_url)
      returning 1`;
    const gone = await tx`
      delete from public.federal_agency_budgets
       where toptier_code <> all(${rows.map((r) => r.toptier_code)}::text[])
      returning 1`;
    return changed.length + gone.length;
  });
  run.log('federal-budget: agencies', { agencies: rows.length, fiscalYear: rows[0]?.fiscal_year });
}

export interface AreaRow extends Record<string, unknown> {
  fiscal_year: number;
  /** "MA" for the state, "MA-09" for a district ("AK-00" at large, "DC-98" a delegate's). */
  area: string;
  state: string;
  district: number | null;
  contracts: number;
  grants: number;
  other: number;
  population: number | null;
}

/** Where a result is: a state by its code, a district by its name ("MA-09"); null for "unknown". */
export function areaOf(
  layer: GeoLayer,
  r: GeographyAmount,
): { area: string; state: string; district: number | null } | null {
  if (layer === 'state')
    return /^[A-Z]{2}$/.test(r.shape_code) ? { area: r.shape_code, state: r.shape_code, district: null } : null;
  const m = /^([A-Z]{2})-(\d{2})$/.exec(r.display_name ?? '');
  return m ? { area: m[0], state: m[1]!, district: Number(m[2]) } : null;
}

/** Each area's contracts, grants and other assistance, from the six searches' results. */
export function areaRows(
  fiscalYear: number,
  results: { layer: GeoLayer; group: AwardGroup; rows: GeographyAmount[] }[],
) {
  const byArea = new Map<string, AreaRow>();
  for (const { layer, group, rows } of results)
    for (const r of rows) {
      const where = areaOf(layer, r);
      const value = amount(r.aggregated_amount);
      if (!where || value === null || Number.isNaN(value)) continue;
      const row = byArea.get(where.area) ?? {
        fiscal_year: fiscalYear,
        ...where,
        contracts: 0,
        grants: 0,
        other: 0,
        population: null,
      };
      row[group] = value;
      if (row.population === null && Number.isInteger(r.population) && r.population! > 0) row.population = r.population;
      byArea.set(where.area, row);
    }
  return [...byArea.values()];
}

async function syncAreas(
  run: JobRun<FederalBudgetCursor>,
  client: UsaSpendingClient,
  cursor: FederalBudgetCursor,
  now: Date,
  minimums: typeof FEDERAL_MINIMUMS,
) {
  const fiscalYear = areaFiscalYear(now);
  const last = cursor.areas;
  if (last?.fiscalYear === fiscalYear && now.getTime() - Date.parse(last.at) < AREA_REFRESH_DAYS * DAY) {
    run.log('federal-budget: areas fresh', { fiscalYear, at: last.at });
    return;
  }
  const results: { layer: GeoLayer; group: AwardGroup; rows: GeographyAmount[] }[] = [];
  for (const layer of ['state', 'district'] as const)
    for (const group of ['contracts', 'grants', 'other'] as const) {
      // Nothing is written until all six are in, so stopping here keeps the stored year whole.
      if (run.outOfTime()) {
        run.log('federal-budget: out of time before the awards were all read', { fiscalYear, read: results.length });
        return;
      }
      const rows = await client.spendingByGeography(layer, fiscalYear, group);
      const places = rows.filter((r) => areaOf(layer, r)).length;
      const min = layer === 'state' ? minimums.states : minimums.districts;
      if (places < min)
        throw new Error(
          `USAspending ${layer} ${group} FY${fiscalYear}: ${places} places (expected at least ${min}); keeping the stored year`,
        );
      results.push({ layer, group, rows });
    }
  const rows = areaRows(fiscalYear, results);
  run.rowsWritten += await run.sql.begin(async (tx) => {
    const changed = await tx`
      insert into public.federal_area_spending as t
        (fiscal_year, area, state, district, contracts, grants, other, population)
      select fiscal_year, area, state, district, contracts, grants, other, population
        from jsonb_to_recordset(${tx.json(rows as never)}::jsonb) as x(
          fiscal_year smallint, area text, state text, district smallint, contracts numeric,
          grants numeric, other numeric, population integer)
      on conflict (area, fiscal_year) do update
        set state = excluded.state, district = excluded.district, contracts = excluded.contracts,
            grants = excluded.grants, other = excluded.other, population = excluded.population,
            updated_at = now()
        where (t.state, t.district, t.contracts, t.grants, t.other, t.population)
          is distinct from (excluded.state, excluded.district, excluded.contracts, excluded.grants,
                            excluded.other, excluded.population)
      returning 1`;
    // One year is kept: the site shows the newest closed year.
    const gone = await tx`
      delete from public.federal_area_spending
       where fiscal_year <> ${fiscalYear} or area <> all(${rows.map((r) => r.area)}::text[])
      returning 1`;
    return changed.length + gone.length;
  });
  cursor.areas = { fiscalYear, at: now.toISOString() };
  run.log('federal-budget: areas', { fiscalYear, areas: rows.length });
}

export async function syncFederalBudget(
  run: JobRun<FederalBudgetCursor>,
  options: {
    treasury: FiscalDataClient;
    usaspending: UsaSpendingClient;
    now?: () => Date;
    /** Tests with small recorded samples lower the floors. */
    minimums?: Partial<typeof FEDERAL_MINIMUMS>;
  },
): Promise<FederalBudgetCursor> {
  const now = options.now?.() ?? new Date();
  const minimums = { ...FEDERAL_MINIMUMS, ...options.minimums };
  const cursor = { ...run.cursor };
  const failures: string[] = [];
  for (const [name, part] of [
    ['statement', () => syncStatements(run, options.treasury, cursor)],
    ['agencies', () => syncAgencies(run, options.usaspending, minimums.agencies)],
    ['areas', () => syncAreas(run, options.usaspending, cursor, now, minimums)],
  ] as const) {
    try {
      await part();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
  return cursor;
}
