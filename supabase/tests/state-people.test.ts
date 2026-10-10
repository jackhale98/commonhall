import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { lightenPhotos, writeStatePeople, type PeopleCommittee, type PeoplePerson, type Sql } from '@civic/sync';
import { asAnon } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = <T>(name: string) =>
  parse(
    readFileSync(new URL(`../../packages/sync/test/fixtures/openstates-people/${name}`, import.meta.url), 'utf8'),
  ) as T;
const liz = fixture<PeoplePerson>('liz-miranda.yml');
const committee = fixture<PeopleCommittee>('initiative-petitions.yml');
const governor = fixture<PeoplePerson>('maura-healey.yml');

beforeEach(async () => {
  await sql`delete from public.state_committees`;
  await sql`delete from public.state_legislators`;
  await sql`delete from public.state_executives`;
});

describe('openstates/people load', () => {
  it('adds contact details to a legislator the API sync holds, keeping its email and photo', async () => {
    await sql`
      insert into public.state_legislators (id, name, party, state, chamber, district, email, photo_url, current)
      values (${liz.id}, 'Liz Miranda', 'Democratic', 'MA', 'upper', 'Second Suffolk',
              'kept@example.test', null, true)`;
    const r = await writeStatePeople(sql, 'MA', [liz], [committee], [], '2026-10-10');
    expect(r).toMatchObject({ legislatorsUpdated: 1, legislatorsAdded: 0, committees: 1, members: 10 });
    const [row] = await sql`select email, photo_url, offices, links from public.state_legislators where id = ${liz.id}`;
    expect(row!.email).toBe('kept@example.test');
    expect(row!.photo_url).toMatch(/malegislature\.gov/);
    expect(row!.offices).toHaveLength(1);
    expect(row!.links).toHaveLength(2);
  });

  it('adds legislators the API sync has not reached, and replaces a state’s committees', async () => {
    const r = await writeStatePeople(sql, 'MA', [liz], [committee], [], '2026-10-10');
    expect(r.legislatorsAdded).toBe(1);
    // A committee that disappears from the repository is removed with its members.
    await writeStatePeople(sql, 'MA', [liz], [], [], '2026-10-10');
    const left = await sql`select count(*)::int as n from public.state_committee_members`;
    expect(left[0]!.n).toBe(0);
  });

  it('is public to read', async () => {
    await writeStatePeople(sql, 'MA', [liz], [committee], [], '2026-10-10');
    const rows = await asAnon(
      sql as never,
      (tx) => tx`
        select c.name, m.role from public.state_committees c
          join public.state_committee_members m on m.committee_id = c.id
         where m.seq = 0`,
    );
    expect(rows).toEqual([{ name: 'Initiative Petitions Special', role: 'chair' }]);
  });

  it('loads statewide officials and replaces them each time', async () => {
    const r = await writeStatePeople(sql, 'MA', [liz], [], [governor], '2026-10-10');
    expect(r.executives).toBe(1);
    const rows = await sql`select name, role, party from public.state_executives where state = 'MA'`;
    expect(rows).toEqual([{ name: 'Maura Healey', role: 'Governor', party: 'Democratic' }]);
    // After the term ends she is no longer listed.
    await writeStatePeople(sql, 'MA', [liz], [], [governor], '2031-01-10');
    expect((await sql`select count(*)::int as n from public.state_executives`)[0]!.n).toBe(0);
  });
});

describe('lighter photos', () => {
  it('maps a heavy photo to a smaller copy on every write', async () => {
    const heavy = 'https://x.gov/wp-content/a/Heavy.png';
    await sql`delete from private.photo_variants`;
    await sql`delete from public.state_legislators where id = 'ocd-person/photo-test'`;
    await sql`
      insert into public.state_legislators (id, name, state, chamber, photo_url, current)
      values ('ocd-person/photo-test', 'Pat Photo', 'DE', 'upper', ${heavy}, true)`;
    const fetch = async (url: string) =>
      new Response(null, {
        headers: { 'content-type': 'image/png', 'content-length': url.endsWith('-150x150.png') ? '9000' : '700000' },
      });
    const r = await lightenPhotos(sql, { fetch, concurrency: 1 });
    expect(r.replaced).toBeGreaterThanOrEqual(1);
    const read = async () =>
      (
        await sql<
          { photo_url: string }[]
        >`select photo_url from public.state_legislators where id = 'ocd-person/photo-test'`
      )[0]!.photo_url;
    expect(await read()).toBe('https://x.gov/wp-content/a/Heavy-150x150.png');
    // A sync writing the original URL again gets the smaller copy.
    await sql`update public.state_legislators set photo_url = ${heavy} where id = 'ocd-person/photo-test'`;
    expect(await read()).toBe('https://x.gov/wp-content/a/Heavy-150x150.png');
    await sql`delete from public.state_legislators where id = 'ocd-person/photo-test'`;
  });
});
