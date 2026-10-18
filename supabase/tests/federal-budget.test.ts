import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FiscalDataClient, UsaSpendingClient, type FetchLike } from '@civic/congress-client';
import { FEDERAL_BUDGET_JOB, runJob, syncFederalBudget, type Sql } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../packages/congress-client/test/fixtures/${name}`, import.meta.url)),
      'utf8',
    ),
  );

async function clean() {
  await sql`delete from public.federal_mts_lines`;
  await sql`delete from public.federal_agency_budgets`;
  await sql`delete from public.federal_area_spending`;
  await sql`delete from public.sync_state where job = ${FEDERAL_BUDGET_JOB}`;
  await sql`delete from public.sync_lock where job = ${FEDERAL_BUDGET_JOB}`;
}
beforeEach(clean);
afterAll(clean);

type Line = Record<string, string>;
const september: Line[] = fixture('treasury/mts9-2026-09-30.json').data;

/**
 * The Treasury and USAspending from recorded responses (October 2026): the September
 * 2026 statement, 16 agencies, and FY2025 awards for every state and 18 districts
 * (Massachusetts', Connecticut's and a few others'). `latest` and `statement` change
 * the Treasury's answers; `districts` the district results.
 */
function sources(
  options: {
    latest?: string;
    statement?: (date: string, lines: Line[]) => Line[];
    districts?: (rows: Record<string, unknown>[]) => Record<string, unknown>[];
  } = {},
) {
  const requests: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    let body: unknown;
    if (url.host === 'api.fiscaldata.treasury.gov') {
      if (url.searchParams.get('fields') === 'record_date') {
        requests.push('treasury:latest');
        body = { data: [{ record_date: options.latest ?? '2026-09-30' }], meta: { 'total-count': 139 } };
      } else {
        const date = url.searchParams.get('filter')!.replace('record_date:eq:', '');
        requests.push(`treasury:${date}`);
        const lines = september.map((l) => ({ ...l, record_date: date }));
        body = { data: options.statement?.(date, lines) ?? lines };
      }
    } else if (url.pathname === '/api/v2/references/toptier_agencies/') {
      requests.push('usaspending:agencies');
      body = fixture('usaspending/toptier-agencies.json');
    } else {
      const search = JSON.parse(String(init?.body)) as { geo_layer: string; filters: { award_type_codes: string[] } };
      const group = { A: 'contracts', '02': 'grants', '06': 'other' }[search.filters.award_type_codes[0]!];
      requests.push(`usaspending:${search.geo_layer}:${group}`);
      body = fixture(`usaspending/geo-${search.geo_layer}-${group}.json`);
      if (search.geo_layer === 'district' && options.districts)
        body = { ...(body as object), results: options.districts((body as { results: [] }).results) };
    }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  const sleep = async () => undefined;
  return {
    treasury: new FiscalDataClient({ fetch, sleep }),
    usaspending: new UsaSpendingClient({ fetch, sleep }),
    requests,
  };
}

const run = (s: ReturnType<typeof sources>, now = '2026-10-18T09:00:00Z') =>
  runJob({
    sql,
    job: FEDERAL_BUDGET_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) =>
      syncFederalBudget(ctx, {
        treasury: s.treasury,
        usaspending: s.usaspending,
        now: () => new Date(now),
        minimums: { agencies: 10, districts: 15 },
      }),
  });

describe('sync-federal-budget', () => {
  it('stores the statement, the agencies and the awards by state and district', async () => {
    const result = await run(sources());
    expect(result.status).toBe('ok');
    // 33 statement lines, 16 agencies, 56 states and territories and 18 districts.
    expect(result.rowsWritten).toBe(33 + 16 + 74);

    const totals = await sql<{ section: string; fytd: string; prior_fytd: string }[]>`
      select section, fytd::text, prior_fytd::text from public.federal_mts_lines
       where record_date = '2026-09-30' and kind = 'T' order by section`;
    expect(totals).toEqual([
      { section: 'outlays', fytd: '7395799983313.23', prior_fytd: '7009985661849.26' },
      { section: 'receipts', fytd: '5403326758960.81', prior_fytd: '5234616472030.91' },
    ]);
    const [heading] = await sql<{ label: string; level: number; kind: string; fytd: string | null }[]>`
      select label, level, kind, fytd from public.federal_mts_lines where record_date = '2026-09-30' and line = 4`;
    expect(heading).toEqual({ label: 'Social Insurance and Retirement Receipts', level: 2, kind: 'S', fytd: null });

    const [treasury] = await sql<{ abbreviation: string; fiscal_year: number; budget_authority: string }[]>`
      select abbreviation, fiscal_year, budget_authority::text from public.federal_agency_budgets
       where toptier_code = '020'`;
    expect(treasury).toEqual({ abbreviation: 'TREAS', fiscal_year: 2026, budget_authority: '3982061714337.72' });

    const areas = await sql<{ area: string; state: string; district: number | null; fiscal_year: number }[]>`
      select area, state, district, fiscal_year from public.federal_area_spending
       where area in ('MA', 'MA-08', 'AK-00', 'DC-98') order by area`;
    expect(areas).toEqual([
      { area: 'AK-00', state: 'AK', district: 0, fiscal_year: 2025 },
      { area: 'DC-98', state: 'DC', district: 98, fiscal_year: 2025 },
      { area: 'MA', state: 'MA', district: null, fiscal_year: 2025 },
      { area: 'MA-08', state: 'MA', district: 8, fiscal_year: 2025 },
    ]);
    const [ma8] = await sql<{ contracts: string; grants: string; other: string; population: number }[]>`
      select contracts::text, grants::text, other::text, population from public.federal_area_spending
       where area = 'MA-08'`;
    const recorded = (group: string) =>
      (
        fixture(`usaspending/geo-district-${group}.json`).results as {
          display_name: string;
          aggregated_amount: number;
        }[]
      ).find((r) => r.display_name === 'MA-08')!.aggregated_amount;
    expect(Number(ma8!.contracts)).toBeCloseTo(recorded('contracts'), 2);
    expect(Number(ma8!.grants)).toBeCloseTo(recorded('grants'), 2);
    expect(Number(ma8!.other)).toBeCloseTo(recorded('other'), 2);
    expect(ma8!.population).toBeGreaterThan(700_000);
  });

  it('reads only what has changed on the next run', async () => {
    await run(sources());
    const quiet = sources();
    const again = await run(quiet, '2026-10-19T09:00:00Z');
    expect(again.status).toBe('ok');
    expect(again.rowsWritten).toBe(0);
    // The same statement and awards read a day ago: only the newest date and the agency list.
    expect(quiet.requests).toEqual(['treasury:latest', 'usaspending:agencies']);
    // A week on, the awards are read again.
    const week = sources();
    await run(week, '2026-10-25T09:00:00Z');
    expect(week.requests.filter((r) => r.includes(':district:') || r.includes(':state:'))).toHaveLength(6);
  });

  it('keeps the year before beside a new year’s first statement', async () => {
    await run(sources());
    const october = sources({
      latest: '2026-10-31',
      statement: (date, lines) =>
        date === '2026-10-31'
          ? lines.map((l) => (l.src_line_nbr === '2' ? { ...l, current_fytd_rcpt_outly_amt: '300000000000.00' } : l))
          : lines,
    });
    const result = await run(october, '2026-11-13T09:00:00Z');
    // The October statement's lines don't add up to its totals: that part fails alone.
    expect(result.status).toBe('error');
    expect(await sql`select 1 from public.federal_agency_budgets`).toHaveLength(16);
    const dates = await sql<{ d: string }[]>`select distinct record_date::text as d from public.federal_mts_lines`;
    expect(dates.map((d) => d.d)).toEqual(['2026-09-30']);

    const fixed = sources({ latest: '2026-10-31' });
    expect((await run(fixed, '2026-11-14T09:00:00Z')).status).toBe('ok');
    expect(fixed.requests.filter((r) => r.startsWith('treasury:2026'))).toEqual([
      'treasury:2026-10-31',
      'treasury:2026-09-30',
    ]);
    const kept = await sql<{ d: string; n: number }[]>`
      select record_date::text as d, count(*)::int as n from public.federal_mts_lines group by 1 order by 1`;
    expect(kept).toEqual([
      { d: '2026-09-30', n: 33 },
      { d: '2026-10-31', n: 33 },
    ]);
  });

  it('keeps the stored awards when the districts read short, and replaces the year when a new one closes', async () => {
    await run(sources());
    const short = await run(sources({ districts: (rows) => rows.slice(0, 5) }), '2026-10-26T09:00:00Z');
    expect(short.status).toBe('error');
    expect(await sql`select 1 from public.federal_area_spending where district is not null`).toHaveLength(18);

    // Four months after FY2026 ends, its awards replace FY2025's.
    await run(sources(), '2027-01-29T09:00:00Z');
    const years = await sql<{ fiscal_year: number; n: number }[]>`
      select fiscal_year, count(*)::int as n from public.federal_area_spending group by 1`;
    expect(years).toEqual([{ fiscal_year: 2026, n: 74 }]);
  });
});
