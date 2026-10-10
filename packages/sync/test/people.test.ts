import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  peopleCommitteeRows,
  peopleLegislatorRow,
  type PeopleCommittee,
  type PeoplePerson,
} from '../src/state/people.ts';

const fixture = <T>(name: string) =>
  parse(readFileSync(new URL(`./fixtures/openstates-people/${name}`, import.meta.url), 'utf8')) as T;

describe('openstates/people legislators', () => {
  const liz = fixture<PeoplePerson>('liz-miranda.yml');

  it('reads the current seat, contact details and links', () => {
    const row = peopleLegislatorRow(liz, 'MA', '2026-10-10')!;
    expect(row).toMatchObject({
      id: 'ocd-person/703d6d4e-3a1d-4a2e-82e3-3c9693b75953',
      name: 'Liz Miranda',
      party: 'Democratic',
      state: 'MA',
      chamber: 'upper',
      district: 'Second Suffolk',
      email: 'liz.miranda@masenate.gov',
    });
    expect(row.offices).toEqual([
      {
        classification: 'capitol',
        address: 'Room 413-C, State House 24 Beacon St., Boston, MA 02133',
        voice: '617-722-1673',
        fax: null,
      },
    ]);
    // "Profile/L M0" and "Profile/L%20M0" are the same page.
    expect(row.links).toEqual([
      'https://malegislature.gov/Legislators/Profile/L M0',
      'https://malegislature.gov/Legislators/Profile/L_M2',
    ]);
  });

  it('skips people with no current seat', () => {
    expect(
      peopleLegislatorRow({ ...liz, roles: [{ type: 'upper', end_date: '2020-01-01' }] }, 'MA', '2026-10-10'),
    ).toBeNull();
  });
});

describe('openstates/people committees', () => {
  it('keeps members in order with their roles', () => {
    const g = peopleCommitteeRows(fixture<PeopleCommittee>('initiative-petitions.yml'), 'MA')!;
    expect(g.committee).toMatchObject({
      id: 'ocd-organization/6d03002e-afdb-4b4c-983a-663b3816a929',
      name: 'Initiative Petitions Special',
      chamber: 'legislature',
      classification: 'committee',
      url: 'https://malegislature.gov/Committees/Detail/SJ42',
      member_count: 10,
    });
    expect(g.members[0]).toMatchObject({ seq: 0, name: 'Alice Peisch', role: 'chair' });
    expect(g.members[2]).toMatchObject({ role: 'ranking member', person_id: expect.stringMatching(/^ocd-person\//) });
  });

  it('links a subcommittee to its parent', () => {
    const g = peopleCommitteeRows(fixture<PeopleCommittee>('subcommittee.yml'), 'XX')!;
    expect(g.committee.classification).toBe('subcommittee');
    expect(g.committee.parent_id).toMatch(/^ocd-organization\//);
  });
});
