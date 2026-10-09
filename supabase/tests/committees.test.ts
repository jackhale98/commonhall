import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CongressClient, LegislatorsClient, RequestBudget, type FetchLike } from '@civic/congress-client';
import { COMMITTEES_JOB, runJob, syncCommittees, type CommitteesCursor, type Sql } from '@civic/sync';
import { asAnon } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../packages/congress-client/test/fixtures/${name}`, import.meta.url)), 'utf8');
const json = (body: string | unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });

/** congress-legislators and Congress.gov fakes built from recorded responses. */
function fakes() {
  const calls: URL[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.endsWith('/committees-current.json'))
      return json(fixture('legislators/committees-current-sample.json'));
    if (url.pathname.endsWith('/committee-membership-current.json'))
      return json(fixture('legislators/committee-membership-sample.json'));
    if (/\/committee-meeting\/119\/house$/.test(url.pathname)) {
      const list = JSON.parse(fixture('congress/committee-meetings-house.json'));
      list.pagination = { count: list.committeeMeetings.length };
      return json(list);
    }
    if (/\/committee-meeting\/119\/senate$/.test(url.pathname))
      return json({ committeeMeetings: [], pagination: { count: 0 } });
    const meeting = /\/committee-meeting\/119\/house\/(\d+)$/.exec(url.pathname);
    if (meeting) {
      // One recorded detail, served under each listed event id.
      const body = JSON.parse(fixture('congress/committee-meeting-119557.json'));
      body.committeeMeeting.eventId = meeting[1];
      return json(body);
    }
    if (url.pathname === '/v3/bill/119/hr/1/actions') {
      const body = JSON.parse(fixture('congress/bill-hr1-actions.json'));
      body.pagination = { count: body.actions.length };
      return json(body);
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

const run = (fetch: FetchLike, now = new Date('2026-10-09T01:00:00Z')) =>
  runJob<CommitteesCursor>({
    sql,
    job: COMMITTEES_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) =>
      syncCommittees(ctx, {
        legislators: new LegislatorsClient({ fetch }),
        client: new CongressClient({
          apiKey: 't',
          fetch,
          budget: new RequestBudget(100, 'congress'),
          sleep: async () => undefined,
        }),
        congress: 119,
        now,
      }),
  });

beforeEach(async () => {
  await sql`delete from public.committee_meetings`;
  await sql`delete from public.committee_members`;
  await sql`delete from public.committees`;
  await sql`delete from public.bill_committees`;
  await sql`delete from public.sync_state where job = ${COMMITTEES_JOB}`;
  await sql`delete from public.sync_lock`;
  await sql`insert into public.bills (id, congress, bill_type, number, title) values ('119-hr-1', 119, 'hr', 1, 'Test')
            on conflict (id) do update set committees_checked = false`;
  await sql`update public.bills set committees_checked = true where id <> '119-hr-1'`;
});

describe('sync-committees', () => {
  it('loads rosters, meetings and older bills’ committees, then stays quiet', async () => {
    const api = fakes();
    const first = await run(api.fetch);
    expect(first.status).toBe('ok');

    const [chair] =
      await sql`select member_id, title from public.committee_members where committee_code = 'ssfi00' and rank = 1 and side = 'majority'`;
    expect(chair!.title).toBe('Chairman');
    const subs = await sql`select code from public.committees where parent_code = 'hsag00' order by code`;
    expect(subs.length).toBeGreaterThan(0);

    const meetings = await sql`select event_id, committee_codes from public.committee_meetings order by event_id`;
    expect(meetings.map((m) => m.event_id)).toEqual(['119248', '119557', '119558']);

    const [bill] = await sql`select committees_checked from public.bills where id = '119-hr-1'`;
    expect(bill!.committees_checked).toBe(true);
    const referrals = await sql`select committee_code from public.bill_committees where bill_id = '119-hr-1'`;
    expect(referrals.map((r) => r.committee_code)).toContain('ssfi00');

    // An hour later: rosters are fresh, meetings unchanged, no bills left to check.
    api.calls.length = 0;
    const second = await run(api.fetch, new Date('2026-10-09T02:00:00Z'));
    expect(second.rowsWritten).toBe(0);
    expect(api.calls.some((u) => u.pathname.endsWith('.json'))).toBe(false);
    expect(api.calls.filter((u) => /\/committee-meeting\/119\/house\/\d+$/.test(u.pathname))).toHaveLength(0);
    const list = api.calls.find((u) => u.pathname === '/v3/committee-meeting/119/house')!;
    expect(list.searchParams.get('fromDateTime')).toBe('2026-10-09T01:00:00Z');
  });

  it('is public to read', async () => {
    await run(fakes().fetch);
    const rows = await asAnon(sql, (tx) => tx`select code from public.committees where code = 'hsag00'`);
    expect(rows).toHaveLength(1);
  });
});
