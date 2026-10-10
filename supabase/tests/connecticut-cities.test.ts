import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CivicClerkClient } from '@civic/congress-client';
import { BRISTOL_JOB, localReps, runJob, syncBristol, type BristolCursor, type Sql } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = (name: string) =>
  readFileSync(new URL(`../../packages/congress-client/test/fixtures/${name}`, import.meta.url), 'utf8');

/** CivicClerk and the city's website from recorded responses; every agenda but 2916 is empty. */
function sources(page = fixture('connecticut/bristol-council.html')) {
  const civicclerk = new CivicClerkClient({
    fetch: async (input) => {
      const url = new URL(input);
      const body =
        url.pathname === '/v1/EventCategories'
          ? fixture('civicclerk/categories.json')
          : url.pathname === '/v1/Events'
            ? fixture(`civicclerk/events-${url.searchParams.get('$skiptoken') === 'page2' ? 2 : 1}.json`)
            : url.pathname === '/v1/Meetings/2916'
              ? fixture('civicclerk/meeting-2916.json')
              : JSON.stringify({ id: Number(url.pathname.split('/').pop()), items: [] });
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    },
  });
  return { civicclerk, fetchPage: async () => page };
}

const run = (page?: string) =>
  runJob<BristolCursor>({
    sql,
    job: BRISTOL_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) => syncBristol(ctx, { ...sources(page), now: () => new Date('2026-10-10T12:00:00Z') }),
  });

beforeEach(async () => {
  await sql`delete from public.local_matters where city = 'ct-bristol'`;
  await sql`delete from public.local_meetings where city = 'ct-bristol'`;
  await sql`delete from public.local_committees where city = 'ct-bristol'`;
  await sql`delete from public.local_officials where city = 'ct-bristol'`;
  await sql`delete from public.sync_state where job = ${BRISTOL_JOB}`;
  await sql`delete from public.sync_lock where job = ${BRISTOL_JOB}`;
});

describe('sync-bristol', () => {
  it('loads the council, its committees, meetings and agenda items', async () => {
    const result = await run();
    expect(result.status).toBe('ok');

    const officials = await sql`select id, seat, district, title from public.local_officials where city = 'ct-bristol'`;
    expect(officials).toHaveLength(7);
    expect(officials.filter((o) => o.district === 3)).toHaveLength(2);

    const committees = await sql`select name from public.local_committees where city = 'ct-bristol' order by name`;
    expect(committees.map((c) => c.name)).toEqual(['Ordinance Committee', 'Real Estate Committee', 'Salary Committee']);

    const meetings = await sql<{ id: string; committees: string[] }[]>`
      select id, committees from public.local_meetings where city = 'ct-bristol'`;
    expect(meetings).toHaveLength(15);
    expect(meetings.some((m) => m.committees.includes('Ordinance Committee'))).toBe(true);

    const items = await sql`
      select i.seq, i.file_number, i.matter_id from public.local_meeting_items i
       where i.meeting_id = 'ct-bristol-m4765' order by seq`;
    expect(items).toHaveLength(19);
    expect(items[0]).toMatchObject({ file_number: '2026-2404', matter_id: 'ct-bristol-202602404' });
    const [matter] = await sql`select * from public.local_matters where id = 'ct-bristol-202602511'`;
    expect(matter).toMatchObject({ type: 'Ordinance', file_number: '2026-2511', body: 'City Council' });
    const actions = await sql`select action_name, event_id from public.local_matter_actions
      where matter_id = 'ct-bristol-202602511'`;
    expect(actions).toEqual([{ action_name: 'On the agenda', event_id: 4765 }]);
  });

  it('reads an old agenda once', async () => {
    await run();
    const again = await run();
    expect(again.status).toBe('ok');
    const [state] = await sql<
      { cursor: BristolCursor }[]
    >`select cursor from public.sync_state where job = ${BRISTOL_JOB}`;
    expect(state!.cursor.read?.['4765']).toBe(2916);
    expect(state!.cursor.backfilled).toBe(true);
    const [actions] = await sql<{ n: number }[]>`
      select count(*)::int n from public.local_matter_actions where matter_id like 'ct-bristol-%'`;
    expect(actions!.n).toBe(19);
  });

  it('refuses a council page that reads short, keeping what it has', async () => {
    await run();
    await sql`update public.sync_state set cursor = cursor - 'peopleAt' where job = ${BRISTOL_JOB}`;
    const broken = await run('<main>redesigned</main>');
    expect(broken.status).toBe('error');
    const [current] = await sql<{ n: number }[]>`
      select count(*)::int n from public.local_officials where city = 'ct-bristol' and current`;
    expect(current!.n).toBe(7);
  });

  it('finds the whole council for an address in a city loaded as district 0', async () => {
    await run();
    const reps = await localReps(sql, 'ct-bristol', 0);
    expect(reps).toHaveLength(7);
  });
});
