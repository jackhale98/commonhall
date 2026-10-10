import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CouncillorIndex,
  Iqm2Client,
  PrimeGovClient,
  SocrataClient,
  parseCitation,
  parseLegiFile,
  type Iqm2MeetingListing,
  type Iqm2Outline,
  type PrimeGovMeeting,
} from '@civic/congress-client';
import {
  CAMBRIDGE_DATA_JOB,
  CAMBRIDGE_JOB,
  runJob,
  syncCambridge,
  syncCambridgeData,
  writeCambridgeMatter,
  type CambridgeCursor,
  type Sql,
} from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../packages/congress-client/test/fixtures/cambridge/${name}`, import.meta.url)),
    'utf8',
  );

const CITY = 'ma-cambridge';

async function clean() {
  await sql`delete from public.local_matters where city = ${CITY}`;
  await sql`delete from public.local_votes where city = ${CITY}`;
  await sql`delete from public.local_meetings where city = ${CITY}`;
  await sql`delete from public.local_officials where city = ${CITY}`;
  await sql`delete from public.local_committees where city = ${CITY}`;
  await sql`delete from public.feed_events where target_id like 'ma-cambridge-%'`;
  await sql`delete from public.capital_projects where city = ${CITY}`;
  await sql`delete from public.city_budget_lines where city = ${CITY}`;
  await sql`delete from public.city_311_reports where city = ${CITY}`;
  await sql`delete from public.sync_state where job in (${CAMBRIDGE_JOB}, ${CAMBRIDGE_DATA_JOB})`;
  await sql`delete from public.sync_lock where job in (${CAMBRIDGE_JOB}, ${CAMBRIDGE_DATA_JOB})`;
}
beforeEach(clean);
afterAll(clean);

/** IQM2 and PrimeGov from recorded pages: one IQM2 council meeting (Dec 22, 2025) and one PrimeGov one (Oct 5, 2026). */
function sources() {
  const iqm2 = new Iqm2Client({ client: 'cambridgema' });
  iqm2.members = async () => JSON.parse(fixture('iqm2-members.json'));
  iqm2.departments = async () => [
    { ID: 1000, Name: 'City Council' },
    { ID: 1056, Name: 'Ordinance Committee' },
    { ID: 1135, Name: 'Water Board' },
  ];
  const listing = JSON.parse(fixture('iqm2-meetings.json')) as Iqm2MeetingListing[];
  // Enough council meetings to pass the "has the archive gone?" check; only Dec 22 has an outline.
  iqm2.meetings = async (year: number, group: number) =>
    year === 2025 && group === 1000
      ? [
          ...listing,
          ...Array.from({ length: 20 }, (_, i) => ({
            Meeting: {
              ...listing[0]!.Meeting,
              ID: 4000 + i,
              Date: `2025-01-${String(i + 6).padStart(2, '0')}T17:30:00.0000000-05:00`,
            },
          })),
        ]
      : [];
  const outline = JSON.parse(fixture('iqm2-outline.json')) as Iqm2Outline;
  iqm2.outline = async (id: number) =>
    id === 4768 ? outline : { Meeting: { ...outline.Meeting, ID: id, Date: '2025-01-06T17:30:00.0000000-05:00' } };
  iqm2.legiFile = async (id: number) => {
    // Every file on the recorded agenda reads as the recorded policy order or City Manager item.
    const page = id === 31623 ? 'iqm2-legifile-31623.html' : 'iqm2-legifile-31555.html';
    return { ...parseLegiFile(fixture(page), id), number: null };
  };

  const primegov = new PrimeGovClient({ client: 'cambridgema' });
  const meeting: PrimeGovMeeting = {
    id: 2451,
    committeeId: 1,
    title: 'Regular City Council Meeting',
    dateTime: '2026-10-05T17:30:00',
    date: 'Oct 05, 2026',
    time: '05:30 PM',
    location: null,
    videoUrl: null,
    documentList: [{ id: 1, templateId: 11925, templateName: 'HTML Final Actions', compileOutputType: 3 }],
  };
  primegov.archived = async (year: number) => (year === 2026 ? [meeting] : []);
  primegov.upcoming = async () => [
    { ...meeting, id: 2896, committeeId: 51, title: 'Water Board Meeting', dateTime: '2026-10-13T17:00:00' },
  ];
  primegov.http.getText = async () => fixture('primegov-final-actions.html');
  return { iqm2, primegov };
}

const run = () =>
  runJob<CambridgeCursor>({
    sql,
    job: CAMBRIDGE_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) => syncCambridge(ctx, { ...sources(), now: () => new Date('2026-10-10T12:00:00Z') }),
  });

describe('sync-cambridge', () => {
  it('loads councillors, meetings, items with sponsors, and roll calls from both systems', async () => {
    const result = await run();
    expect(result.status).toBe('ok');

    const officials = await sql<{ id: string; current: boolean; seat: string; title: string | null }[]>`
      select id, current, seat, title from public.local_officials where city = ${CITY} order by id`;
    expect(officials.filter((o) => o.current)).toHaveLength(9);
    expect(officials.every((o) => o.seat === 'At-Large')).toBe(true);
    // Councillors who served in 2025 and left are kept (not current) so their votes are theirs.
    expect(officials.find((o) => o.id === 'ma-cambridge-paul-toner')).toMatchObject({ current: false });

    const meetings = await sql<{ id: string; committees: string[] }[]>`
      select id, committees from public.local_meetings where city = ${CITY} order by id`;
    expect(meetings.map((m) => m.id)).toContain('ma-cambridge-pg2451');
    expect(meetings.map((m) => m.id)).toContain('ma-cambridge-m4768');
    expect(meetings.some((m) => m.id === 'ma-cambridge-pg2896')).toBe(false);

    const [por] = await sql`
      select file_number, type, status, latest_action_date::text as latest, legistar_url
        from public.local_matters where id = 'ma-cambridge-220260185'`;
    expect(por).toMatchObject({
      file_number: 'POR 2026-185',
      type: 'Policy order',
      status: 'Referred to Ordinance Committee as amended',
      latest: '2026-10-05',
    });
    const sponsors = await sql`
      select official_id from public.local_matter_sponsors where matter_id = 'ma-cambridge-220260185' order by sequence`;
    expect(sponsors.map((s) => s.official_id)).toEqual([
      'ma-cambridge-jivan-sobrinho-wheeler',
      'ma-cambridge-ayah-al-zubi',
      'ma-cambridge-marc-mcgovern',
      'ma-cambridge-sumbul-siddiqui',
      'ma-cambridge-patricia-nolan',
    ]);
    const [split] = await sql`
      select yea_total, nay_total, result from public.local_votes where matter_id = 'ma-cambridge-220260181'`;
    expect(split).toMatchObject({ yea_total: 6, nay_total: 3, result: 'Pass' });
    // Ceremonial resolutions have no roll calls stored, and communications aren't kept at all.
    expect(await sql`select 1 from public.local_votes where matter_id like 'ma-cambridge-3%'`).toHaveLength(0);
    expect(await sql`select 1 from public.local_matters where city = ${CITY} and file_number like 'COM%'`).toHaveLength(
      0,
    );

    // The 2025 file from IQM2: its failed roll call, with a former councillor's vote.
    const [failed] = await sql`
      select v.yea_total, v.nay_total, v.result from public.local_votes v where v.matter_id = 'ma-cambridge-220250171'`;
    expect(failed).toMatchObject({ yea_total: 4, nay_total: 5, result: 'Fail' });
    const [toner] = await sql`
      select p.position from public.local_vote_positions p
        join public.local_votes v on v.id = p.vote_id
       where v.matter_id = 'ma-cambridge-220250171' and p.official_id = 'ma-cambridge-paul-toner'`;
    expect(toner).toMatchObject({ position: 'nay' });

    const items = await sql`select matter_id from public.local_meeting_items where meeting_id = 'ma-cambridge-m4768'`;
    expect(items.length).toBeGreaterThan(3);
    const committees = await sql`select slug from public.local_committees where city = ${CITY}`;
    expect(committees.map((c) => c.slug)).toContain('ordinance-committee');
  });

  it('writes nothing on a quiet rerun and keeps the IQM2 archive done', async () => {
    await run();
    const again = await run();
    expect(again.status).toBe('ok');
    expect(again.rowsWritten).toBe(0);
    const [state] = await sql<
      { cursor: CambridgeCursor }[]
    >`select cursor from public.sync_state where job = ${CAMBRIDGE_JOB}`;
    expect(state!.cursor.iqm2Done).toBe(true);
  });

  it('merges a file’s actions from both systems, each replacing only its own', async () => {
    await sql`insert into public.local_officials (id, city, name, seat, current) values
      ('ma-cambridge-patricia-nolan', ${CITY}, 'Patricia Nolan', 'At-Large', true)`;
    const people = new CouncillorIndex([{ id: 'ma-cambridge-patricia-nolan', name: 'Patricia Nolan' }]);
    const citation = parseCitation('POR 2025 #171')!;
    const iqm2 = {
      citation,
      title: 'Old wording',
      url: 'https://cambridgema.iqm2.com/Citizens/Detail_LegiFile.aspx?ID=31555',
      sponsors: ['Councillor Patricia Nolan'],
      actions: [
        {
          date: '2025-12-22',
          name: 'Charter Right',
          text: null,
          body: 'City Council',
          passed: null,
          eventId: 4768,
          vote: null,
        },
      ],
      replaces: (e: number | null) => e === null || e < 1_000_000,
    };
    const primegov = {
      citation,
      title: 'New wording',
      url: 'https://cambridgema.primegov.com/Portal/Meeting?meetingTemplateId=1',
      sponsors: ['COUNCILLOR NOLAN'],
      actions: [
        {
          date: '2026-01-12',
          name: 'Order Adopted',
          text: null,
          body: 'City Council',
          passed: 'Pass',
          eventId: 1_000_429,
          vote: null,
        },
      ],
      replaces: (e: number | null) => e === 1_000_429,
    };
    await writeCambridgeMatter(sql, primegov, people, true);
    await writeCambridgeMatter(sql, iqm2, people, true);
    const actions = await sql`
      select action_date::text as date, action_name from public.local_matter_actions
       where matter_id = 'ma-cambridge-220250171' order by seq`;
    expect(actions).toEqual([
      { date: '2025-12-22', action_name: 'Charter Right' },
      { date: '2026-01-12', action_name: 'Order Adopted' },
    ]);
    const [matter] = await sql`
      select title, status, passed_date::text as passed, intro_date::text as intro from public.local_matters
       where id = 'ma-cambridge-220250171'`;
    // The newer record's wording stays although the older one was read last.
    expect(matter).toMatchObject({
      title: 'New wording',
      status: 'Order Adopted',
      passed: '2026-01-12',
      intro: '2025-12-22',
    });
    // Rewriting one source again changes nothing.
    expect(await writeCambridgeMatter(sql, iqm2, people, true)).toBe(0);
    // The IQM2 action arrived after the matter existed: one feed event for it.
    const events =
      await sql`select kind from public.feed_events where target_id = 'ma-cambridge-220250171' order by id`;
    expect(events.map((e) => e.kind)).toEqual(['new_item', 'action']);
  });
});

describe('sync-cambridge-data', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  function socrata(capitalRows = 12) {
    const fetch = async (input: string) => {
      const url = new URL(input);
      const id = url.pathname.split('/').pop()!.replace('.json', '');
      const select = url.searchParams.get('$select') ?? '';
      const offset = Number(url.searchParams.get('$offset') ?? 0);
      let rows: Record<string, unknown>[] = [];
      if (offset > 0) rows = [];
      else if (id === '2z9k-mv9g')
        rows = Array.from({ length: 40 }, (_, i) => ({
          ticket_created_date_time: `2026-${i < 20 ? '09-20' : '10-08'}T09:00:00.000`,
          ticket_closed_date_time: i % 2 ? `2026-${i < 20 ? '09-20' : '10-08'}T13:00:00.000` : undefined,
          issue_category: i % 3 ? 'Pothole' : 'Graffiti',
          ticket_status: i % 2 ? 'Closed' : 'Open',
        }));
      else if (select.startsWith('max(')) rows = [{ fy: '2027' }];
      else if (id === '5bn4-5wey')
        rows = [2026, 2027].map((fy) => ({
          fiscal_year: String(fy),
          service: 'Public Safety',
          department_name: 'Police Department',
          division_name: 'Patrol',
          category: 'Salaries & Wages',
          amount: String(fy === 2027 ? 1000 : 900),
        }));
      else if (id === 'ixyv-mje6')
        rows = [
          {
            fiscal_year: '2027',
            service: 'Public Safety',
            department_name: 'Police Department',
            category: 'Taxes',
            description: 'Taxes',
            amount: '1000',
          },
        ];
      else if (id === '9chi-2ed3')
        rows = Array.from({ length: capitalRows }, (_, i) => ({
          fiscal_year: String(2027 + (i % 5)),
          department: 'Public Works',
          project_id: `00${100 + Math.floor(i / 1)}`,
          project_name: `Project ${i}`,
          fund: 'Public Ways Fund',
          approved_amount: '1000',
        }));
      return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
    };
    return new SocrataClient('data.cambridgema.gov', { fetch, sleep: async () => undefined });
  }
  const runData = (client: SocrataClient) =>
    runJob({
      sql,
      job: CAMBRIDGE_DATA_JOB,
      timeLimitMs: 60_000,
      log: () => undefined,
      run: (ctx) => syncCambridgeData(ctx, { client, now: () => now }),
    });

  it('stores the 311 report, budget lines and capital plan for Cambridge only', async () => {
    await sql`insert into public.capital_projects (city, proj_id, plan, name) values ('ma-boston', '00100', 'FY27-31', 'Boston project')
              on conflict do nothing`;
    const result = await runData(socrata());
    expect(result.status).toBe('ok');
    const [report] = await sql<{ report: { onTime?: boolean; city: { opened: number } } }[]>`
      select report from public.city_311_reports where city = ${CITY}`;
    expect(report!.report).toMatchObject({ onTime: false, city: { opened: 40 } });
    expect(await sql`select 1 from public.city_budget_lines where city = ${CITY}`).toHaveLength(3);
    expect(await sql`select 1 from public.capital_projects where city = ${CITY}`).toHaveLength(12);
    // Same project id in Boston: both kept, keyed by city.
    expect(await sql`select 1 from public.capital_projects where proj_id = '00100'`).toHaveLength(2);
    await sql`delete from public.capital_projects where city = 'ma-boston' and name = 'Boston project'`;
  });

  it('keeps the stored plan when the capital file reads short, and still updates the rest', async () => {
    await runData(socrata());
    const short = await runData(socrata(3));
    expect(short.status).toBe('error');
    expect(await sql`select 1 from public.capital_projects where city = ${CITY}`).toHaveLength(12);
  });
});
