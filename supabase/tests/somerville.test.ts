/**
 * Somerville: the shared Legistar sync with Somerville's settings (seats from titles,
 * committee bodies), the ward map dissolved from precincts, and the 311 report row.
 * Touches only ma-somerville rows and its own jobs, so it can run beside other cities.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LegistarClient, report311, type Day311, type FetchLike } from '@civic/congress-client';
import {
  SOMERVILLE,
  SOMERVILLE_CITY,
  SOMERVILLE_JOB,
  runJob,
  somervilleRow311,
  storeReport311,
  syncLegistarCity,
  type BostonCursor,
  type Sql,
} from '@civic/sync';
import { loadDistricts } from '../../scripts/load-districts.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = <T>(name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../packages/sync/test/fixtures/somerville/${name}`, import.meta.url), 'utf8'),
  ) as T;

/** Somerville's Legistar from recorded responses. */
class FakeLegistar {
  requests: URL[] = [];
  fetch: FetchLike = async (input) => {
    const url = new URL(input);
    this.requests.push(url);
    const path = url.pathname.replace('/v1/somervillema/', '');
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const filter = url.searchParams.get('$filter') ?? '';
    if (path === 'bodies') return json(fixture('bodies.json'));
    if (path === 'officerecords') return json(fixture('officerecords.json'));
    if (path === 'events') {
      const bodies = [...filter.matchAll(/EventBodyId eq (\d+)/g)].map((m) => Number(m[1]));
      const events = fixture<{ EventBodyId: number }[]>('events.json').filter((e) => bodies.includes(e.EventBodyId));
      return json(/EventDate ge/.test(filter) ? events : []);
    }
    if (path === 'events/4073/eventitems') return json(fixture('eventitems-4073.json'));
    if (/^events\/\d+\/eventitems$/.test(path)) return json([]);
    if (path === 'matters') return json(/MatterIntroDate ge/.test(filter) ? fixture('matters.json') : []);
    if (path === 'matters/34931/histories') return json(fixture('histories-34931.json'));
    if (path === 'matters/34931/sponsors') return json(fixture('sponsors-34931.json'));
    return new Response('not found', { status: 404 });
  };
}

async function clear() {
  await sql`delete from public.local_matters where city = ${SOMERVILLE_CITY}`;
  await sql`delete from public.local_meetings where city = ${SOMERVILLE_CITY}`;
  await sql`delete from public.local_officials where city = ${SOMERVILLE_CITY}`;
  await sql`delete from public.local_committees where city = ${SOMERVILLE_CITY}`;
  await sql`delete from public.feed_events where payload->>'city' = ${SOMERVILLE_CITY}`;
  await sql`delete from public.sync_state where job = ${SOMERVILLE_JOB}`;
  await sql`delete from public.sync_lock where job = ${SOMERVILLE_JOB}`;
}

beforeEach(clear);
afterAll(clear);

describe('sync-somerville', () => {
  it('loads councilors by ward, committee meetings by body, and legislation', async () => {
    const api = new FakeLegistar();
    const result = await runJob<BostonCursor>({
      sql,
      job: SOMERVILLE_JOB,
      timeLimitMs: 60_000,
      log: () => undefined,
      run: (ctx) =>
        syncLegistarCity(ctx, {
          client: new LegistarClient({ client: SOMERVILLE.legistar, fetch: api.fetch }),
          city: SOMERVILLE,
          startDate: '2026-08-01T00:00:00Z',
          now: () => new Date('2026-10-10T12:00:00Z'),
        }),
    });
    expect(result.status).toBe('ok');

    const officials = await sql`
      select seat, district from public.local_officials where city = ${SOMERVILLE_CITY} order by district nulls last`;
    expect(officials).toHaveLength(11);
    expect(officials.filter((o) => o.seat === 'At-Large')).toHaveLength(4);
    expect(officials.slice(0, 7).map((o) => o.district)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // Council and committee meetings in one request, each committee meeting filed under its body.
    const events = api.requests.filter((u) => u.pathname.endsWith('/events'));
    expect(events[0]!.searchParams.get('$filter')).toMatch(/^\(EventBodyId eq 138 or EventBodyId eq \d+/);
    const meetings = await sql`
      select event_id, committees from public.local_meetings where city = ${SOMERVILLE_CITY} order by event_id`;
    expect(meetings.map((m) => [m.event_id, m.committees])).toEqual([
      [4057, []],
      [4073, ['Finance']],
    ]);
    const items =
      await sql`select count(*)::int as n from public.local_meeting_items where meeting_id = 'ma-somerville-e4073'`;
    expect(items[0]!.n).toBe(3);
    const committees = await sql`select name from public.local_committees where city = ${SOMERVILLE_CITY}`;
    expect(committees).toHaveLength(10);

    const [matter] = await sql`select * from public.local_matters where id = 'ma-somerville-34931'`;
    expect(matter).toMatchObject({ file_number: '26-1303', type: 'Resolution', latest_action_text: 'Approved' });
    const sponsors =
      await sql`select official_id from public.local_matter_sponsors where matter_id = 'ma-somerville-34931'`;
    expect(sponsors.map((s) => s.official_id)).toContain('ma-somerville-p195');

    // A quiet rerun writes nothing and keeps the committee body ids in the cursor.
    const again = await runJob<BostonCursor>({
      sql,
      job: SOMERVILLE_JOB,
      timeLimitMs: 60_000,
      log: () => undefined,
      run: (ctx) =>
        syncLegistarCity(ctx, {
          client: new LegistarClient({ client: SOMERVILLE.legistar, fetch: api.fetch }),
          city: SOMERVILLE,
          startDate: '2026-08-01T00:00:00Z',
          now: () => new Date('2026-10-10T12:15:00Z'),
        }),
    });
    expect(again.rowsWritten).toBe(0);
    expect(Object.keys(again.cursor?.committeeBodyIds ?? {})).toHaveLength(10);
  });
});

describe('Somerville wards and 311', () => {
  it('dissolves precincts into one shape per ward', async () => {
    const square = (x: number, y: number) => ({
      type: 'Polygon',
      coordinates: [
        [
          [x, y],
          [x + 0.01, y],
          [x + 0.01, y + 0.01],
          [x, y + 0.01],
          [x, y],
        ],
      ],
    });
    const features = [
      { properties: { WARD: '1', PRECINCT: '1' }, geometry: square(-71.1, 42.38) },
      { properties: { WARD: '1', PRECINCT: '2' }, geometry: square(-71.09, 42.38) },
      { properties: { WARD: '2', PRECINCT: '1' }, geometry: square(-71.08, 42.38) },
    ];
    const n = await loadDistricts(sql as never, { features }, 'test', SOMERVILLE_CITY, { districtProp: 'WARD' });
    expect(n).toBe(2);
    const [hit] = await sql`select public.council_district_at(${SOMERVILLE_CITY}, 42.385, -71.085) as d`;
    expect(hit!.d).toBe(1);
    const [parts] = await sql`
      select extensions.st_numgeometries(geometry) as n from public.council_districts
       where city = ${SOMERVILLE_CITY} and district = 1`;
    expect(parts!.n).toBe(1);
    await sql`delete from public.council_districts where city = ${SOMERVILLE_CITY}`;
  });

  it('stores the 311 report once, and again only when it changes', async () => {
    const rows = fixture<Record<string, unknown>[]>('soql-311.json')
      .map(somervilleRow311)
      .filter((r): r is Day311 => r !== null);
    const report = report311(rows, { districts: 7, onTime: false })!;
    await sql`delete from public.city_311_reports where city = ${SOMERVILLE_CITY}`;
    expect(await storeReport311(sql, SOMERVILLE_CITY, report)).toBe(1);
    expect(await storeReport311(sql, SOMERVILLE_CITY, report)).toBe(0);
    const [row] = await sql`select report from public.city_311_reports where city = ${SOMERVILLE_CITY}`;
    expect(row!.report).toMatchObject({ onTime: false, city: { opened: report.city.opened } });
    await sql`delete from public.city_311_reports where city = ${SOMERVILLE_CITY}`;
  });
});
