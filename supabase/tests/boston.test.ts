import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LegistarClient, type FetchLike, type LegistarMatter } from '@civic/congress-client';
import { BOSTON_JOB, meetingStart, runJob, syncBoston, type BostonCursor, type SeatMap, type Sql } from '@civic/sync';
import { loadDistricts } from '../../scripts/load-districts.ts';
import { asAnon, asUser, createUser } from './auth.ts';
import { connect } from './db.ts';
import { fixtureJson } from './fake-congress.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const seats = JSON.parse(
  readFileSync(fileURLToPath(new URL('../data/boston-council-seats.json', import.meta.url)), 'utf8'),
) as SeatMap;

/** In-memory Legistar built from recorded Boston responses. */
class FakeLegistar {
  matters: LegistarMatter[] = fixtureJson<LegistarMatter[]>('legistar/matters.json');
  histories = new Map<number, unknown[]>([[43547, fixtureJson('legistar/histories-43547.json')]]);
  sponsors = new Map<number, unknown[]>([[43547, fixtureJson('legistar/sponsors-43547.json')]]);
  events = fixtureJson<Record<string, unknown>[]>('legistar/events.json');
  officeRecords = fixtureJson<Record<string, unknown>[]>('legistar/officerecords.json');
  requests: URL[] = [];

  fetch: FetchLike = async (input) => {
    const url = new URL(input);
    this.requests.push(url);
    const path = url.pathname.replace('/v1/boston/', '');
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const since = /gt datetime'([^']+)'/.exec(url.searchParams.get('$filter') ?? '')?.[1];
    const after = (stamp: string) => !since || `${stamp}Z` > `${since}Z` || stamp > since;
    if (path === 'bodies') return json([{ BodyId: 138, BodyName: 'City Council' }]);
    if (path === 'officerecords') return json(this.officeRecords);
    if (path === 'matters') {
      const introducedSince = /MatterIntroDate ge datetime'([^']+)'/.exec(url.searchParams.get('$filter') ?? '')?.[1];
      if (introducedSince) {
        // First load: newest first, paged.
        const skip = Number(url.searchParams.get('$skip') ?? 0);
        const top = Number(url.searchParams.get('$top') ?? 1000);
        return json(
          this.matters
            .filter((m) => (m.MatterIntroDate ?? '') >= introducedSince)
            .sort((a, b) => (b.MatterIntroDate ?? '').localeCompare(a.MatterIntroDate ?? '') || b.MatterId - a.MatterId)
            .slice(skip, skip + top),
        );
      }
      return json(
        this.matters
          .filter((m) => after(m.MatterLastModifiedUtc))
          .sort((a, b) => a.MatterLastModifiedUtc.localeCompare(b.MatterLastModifiedUtc)),
      );
    }
    let m: RegExpExecArray | null;
    if ((m = /^matters\/(\d+)\/histories$/.exec(path))) return json(this.histories.get(Number(m[1])) ?? []);
    if ((m = /^matters\/(\d+)\/sponsors$/.exec(path))) return json(this.sponsors.get(Number(m[1])) ?? []);
    if (path === 'events') {
      const from = /EventDate ge datetime'([^']+)'/.exec(url.searchParams.get('$filter') ?? '')?.[1];
      if (from) return json(this.events.filter((e) => String(e.EventDate) >= from));
      return json(this.events.filter((e) => after(String(e.EventLastModifiedUtc))));
    }
    if (/^events\/\d+\/eventitems$/.test(path)) return json(fixtureJson('legistar/eventitems-14256.json'));
    return new Response('not found', { status: 404 });
  };
}

async function run(api: FakeLegistar) {
  return runJob<BostonCursor>({
    sql,
    job: BOSTON_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) =>
      syncBoston(ctx, {
        client: new LegistarClient({ fetch: api.fetch }),
        seats,
        startDate: '2026-01-01T00:00:00Z',
        now: () => new Date('2026-10-08T06:00:00Z'),
      }),
  });
}

beforeAll(async () => {
  await loadDistricts(sql as never, fixtureJson('legistar/council-districts-simplified.geojson'), 'test fixture');
});

beforeEach(async () => {
  await sql`truncate public.local_matters, public.local_officials, public.local_meetings, public.local_votes cascade`;
  await sql`truncate public.feed_events, public.follows`;
  await sql`delete from public.sync_state where job = ${BOSTON_JOB}`;
  await sql`delete from public.sync_lock`;
  await sql`delete from auth.users where email like '%@example.test'`;
});

describe('sync-boston', () => {
  it('loads councilors with seats, legislative matters with actions and sponsors, and meetings', async () => {
    const api = new FakeLegistar();
    const result = await run(api);
    expect(result.status).toBe('ok');

    const officials =
      await sql`select name, seat, district from public.local_officials order by district nulls last, name`;
    expect(officials).toHaveLength(13);
    expect(officials.filter((o) => o.seat === 'At-Large')).toHaveLength(4);
    expect(officials.find((o) => o.name === 'Miniard Culpepper')).toMatchObject({ seat: 'District 7', district: 7 });

    const [matter] = await sql`select * from public.local_matters where id = 'boston-43547'`;
    expect(matter).toMatchObject({
      file_number: '2026-1882',
      type: 'Council Legislative Resolution',
      status: 'Passed',
      latest_action_text: 'The rules were suspended; the resolution was adopted.',
    });
    expect(matter!.legistar_url).toBe('https://boston.legistar.com/gateway.aspx?M=L&ID=43547');
    const sponsors =
      await sql`select official_id from public.local_matter_sponsors where matter_id = 'boston-43547' order by sequence`;
    expect(sponsors.map((s) => s.official_id)).toContain('boston-p256');

    const meetings = await sql`select id, starts_at, date from public.local_meetings order by date desc`;
    expect(meetings).toHaveLength(3);
    // 12:00 PM Eastern (daylight time) on 2026-10-07 is 16:00 UTC.
    expect(new Date(meetings[0]!.starts_at).toISOString()).toBe('2026-10-07T16:00:00.000Z');

    // First load: no feed events.
    expect(await sql`select * from public.feed_events`).toHaveLength(0);
  });

  it('writes nothing on a quiet rerun, then emits events for a new action and a new matter', async () => {
    const api = new FakeLegistar();
    await run(api);
    const quiet = await run(api);
    expect(quiet.rowsWritten).toBe(0);

    // Upstream: a new action on 43547 and a brand-new resolution.
    const m = api.matters.find((x) => x.MatterId === 43547)!;
    m.MatterLastModifiedUtc = '2026-10-08T07:00:00.000';
    api.histories.set(43547, [
      ...(api.histories.get(43547) ?? []),
      {
        MatterHistoryId: 999,
        MatterHistoryActionDate: '2026-10-07T00:00:00',
        MatterHistoryActionName: 'Referred to the Mayor',
        MatterHistoryActionBodyName: 'City Council',
      },
    ]);
    api.matters.push({
      ...m,
      MatterId: 50001,
      MatterGuid: 'NEW',
      MatterFile: '2026-2000',
      MatterTitle: 'Order for a hearing on bike lanes.',
      MatterTypeName: 'Council Hearing Order',
      MatterLastModifiedUtc: '2026-10-08T07:05:00.000',
    });
    api.sponsors.set(50001, [
      {
        MatterSponsorMatterId: 50001,
        MatterSponsorNameId: 324,
        MatterSponsorName: 'Benjamin Jacob Weber',
        MatterSponsorSequence: 0,
      },
    ]);

    await run(api);
    const events =
      await sql`select kind, target_id, member_type, member_id, summary from public.feed_events order by kind`;
    expect(events.map((e) => [e.kind, e.target_id])).toEqual([
      ['action', 'boston-43547'],
      ['new_item', 'boston-50001'],
    ]);
    expect(events[0]!.summary).toBe('Boston Docket #2026-1882: Referred to the Mayor');
    expect(events[1]).toMatchObject({ member_type: 'local_official', member_id: 'boston-p324' });

    // Followers of the councilor see the new matter.
    const user = await createUser(sql);
    await asUser(
      sql,
      user,
      (tx) =>
        tx`insert into public.follows (user_id, target_type, target_id) values (${user}, 'local_official', 'boston-p324')`,
    );
    const feed = await asUser(sql, user, (tx) => tx`select kind, target_id, reason from public.feed`);
    expect(feed).toEqual([{ kind: 'new_item', target_id: 'boston-50001', reason: 'legislator' }]);
  });

  it('skips non-legislative records (agendas, minutes, reports)', async () => {
    const api = new FakeLegistar();
    api.matters.push({
      ...api.matters[0]!,
      MatterId: 60001,
      MatterTypeName: 'Minutes',
      MatterLastModifiedUtc: '2026-10-07T20:00:00.000',
    });
    await run(api);
    expect(await sql`select * from public.local_matters where matter_id = 60001`).toHaveLength(0);
    expect(api.requests.some((u) => u.pathname.includes('/matters/60001/'))).toBe(false);
  });
});

describe('council districts', () => {
  it('finds the district for points in Boston and nothing outside it', async () => {
    const at = async (lat: number, lng: number) =>
      (await sql`select public.council_district_at('boston', ${lat}, ${lng}) as d`)[0]!.d;
    expect(await at(42.3587, -71.0636)).toBe(8); // State House, Beacon Hill
    expect(await at(42.284, -71.0716)).toBe(4); // Mattapan
    expect(await at(42.3736, -71.1097)).toBeNull(); // Cambridge
  });

  it('computes meeting start times across daylight saving changes', () => {
    expect(meetingStart('2026-10-07T00:00:00', '12:00 PM')).toBe('2026-10-07T16:00:00.000Z');
    expect(meetingStart('2026-12-02T00:00:00', '12:00 PM')).toBe('2026-12-02T17:00:00.000Z');
    expect(meetingStart('2026-12-02T00:00:00', null)).toBeNull();
  });
});

describe('council matter filters', () => {
  it('counts each facet given the other filters', async () => {
    const city = 'facettest';
    await sql`delete from public.local_matters where city = ${city}`;
    const rows = [
      ['facettest-1', 1, 'Ordinance', 'Passed'],
      ['facettest-2', 2, 'Ordinance', 'Assigned to Committee'],
      ['facettest-3', 3, 'Order', 'Passed'],
      ['facettest-4', 4, 'Order', 'Passed'],
    ] as const;
    for (const [id, matterId, type, status] of rows) {
      await sql`insert into public.local_matters (id, city, matter_id, title, type, status)
                values (${id}, ${city}, ${matterId}, ${`Test ${type}`}, ${type}, ${status})`;
    }
    const facets = async (type: string | null, status: string | null) =>
      Object.fromEntries(
        (
          await asAnon(
            sql,
            (tx) => tx`select facet, value, n from public.local_matter_facets(${city}, ${type}, ${status})`,
          )
        ).map((r) => [`${r.facet}:${r.value}`, r.n]),
      );
    // Choosing a type narrows the status counts, and vice versa.
    expect(await facets('Ordinance', null)).toMatchObject({ 'status:Passed': 1, 'status:Assigned to Committee': 1 });
    expect(await facets(null, 'Passed')).toMatchObject({ 'type:Ordinance': 1, 'type:Order': 2 });
    expect(await facets(null, null)).toMatchObject({ 'status:Passed': 3, 'type:Order': 2 });
    // Hidden types (consent-agenda resolutions in the app) drop out of the status
    // counts of the default list but stay listed as types, so they can be chosen.
    const hidden = Object.fromEntries(
      (
        await asAnon(
          sql,
          (tx) =>
            tx`select facet, value, n from public.local_matter_facets(${city}, null, null, null, null, ${['Order']})`,
        )
      ).map((r) => [`${r.facet}:${r.value}`, r.n]),
    );
    expect(hidden).toMatchObject({ 'status:Passed': 1, 'status:Assigned to Committee': 1, 'type:Order': 2 });
    await sql`delete from public.local_matters where city = ${city}`;
  });
});
