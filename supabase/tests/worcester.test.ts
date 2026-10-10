import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrimeGovClient, type PrimeGovMeeting } from '@civic/congress-client';
import { WORCESTER_JOB, runJob, syncWorcester, type Sql, type WorcesterCursor } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = (name: string) =>
  readFileSync(new URL(`../../packages/congress-client/test/fixtures/worcester/${name}`, import.meta.url), 'utf8');

/** PrimeGov and the city's website, from recorded responses. */
function sources(pages: Record<string, string> = {}) {
  const primegov = new PrimeGovClient();
  const archived = JSON.parse(fixture('archived-2026.json')) as PrimeGovMeeting[];
  primegov.archived = async (year: number) => (year === 2026 ? archived : []);
  primegov.upcoming = async () => JSON.parse(fixture('upcoming.json')) as PrimeGovMeeting[];
  const fetchPage = async (url: string) =>
    pages[url] ?? (url.endsWith('/councilors') ? fixture('councilors.html') : fixture('committees.html'));
  return { primegov, fetchPage };
}

const run = (pages?: Record<string, string>) =>
  runJob<WorcesterCursor>({
    sql,
    job: WORCESTER_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) => syncWorcester(ctx, { ...sources(pages), now: () => new Date('2026-10-10T12:00:00Z') }),
  });

beforeEach(async () => {
  await sql`delete from public.local_meetings where city = 'ma-worcester'`;
  await sql`delete from public.local_committees where city = 'ma-worcester'`;
  await sql`delete from public.local_officials where city = 'ma-worcester'`;
  await sql`delete from public.sync_state where job = ${WORCESTER_JOB}`;
  await sql`delete from public.sync_lock`;
});

describe('sync-worcester', () => {
  it('loads councilors, committees with members, and council meetings only', async () => {
    const result = await run();
    expect(result.status).toBe('ok');

    const officials = await sql`select id, seat, district from public.local_officials where city = 'ma-worcester'`;
    expect(officials).toHaveLength(11);
    expect(officials.filter((o) => o.district !== null)).toHaveLength(5);

    const members = await sql`
      select m.name, m.role, m.official_id from public.local_committee_members m
        join public.local_committees c on c.id = m.committee_id
       where c.slug = 'traffic-and-parking' order by m.seq`;
    expect(members.map((m) => [m.official_id, m.role])).toEqual([
      ['ma-worcester-jose-rivera', 'Chair'],
      ['ma-worcester-luis-ojeda', 'Vice Chair'],
      ['ma-worcester-robert-bilotta', null],
    ]);

    const meetings = await sql<{ committees: string[]; agenda_url: string | null }[]>`
      select committees, agenda_url from public.local_meetings where city = 'ma-worcester'`;
    expect(meetings.length).toBeGreaterThan(10);
    // Boards and commissions (License Commission, school councils) are left out.
    expect(meetings.some((m) => m.committees.length === 0)).toBe(true);
    expect(meetings.some((m) => m.committees.includes('Traffic and Parking'))).toBe(true);
  });

  it('writes nothing on a quiet rerun', async () => {
    await run();
    await sql`update public.sync_state set cursor = cursor - 'peopleAt' where job = ${WORCESTER_JOB}`;
    const again = await run();
    expect(again.rowsWritten).toBe(0);
  });

  it('refuses a councilors page that reads short, keeping what it has', async () => {
    await run();
    await sql`update public.sync_state set cursor = cursor - 'peopleAt' where job = ${WORCESTER_JOB}`;
    const broken = await run({ 'https://www.worcesterma.gov/city-council/councilors': '<main>redesigned</main>' });
    expect(broken.status).toBe('error');
    const [row] = await sql<
      { n: number }[]
    >`select count(*)::int as n from public.local_officials where city = 'ma-worcester' and current`;
    expect(row!.n).toBe(11);
  });
});
