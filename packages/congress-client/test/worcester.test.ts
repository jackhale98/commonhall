import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseWorcesterCommittees,
  parseWorcesterCouncilors,
  worcesterMeetingKind,
  worcesterOfficialId,
} from '../src/worcester.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/worcester/${name}`, import.meta.url), 'utf8');

describe('Worcester councilors', () => {
  const councilors = parseWorcesterCouncilors(fixture('councilors.html'));

  it('reads all eleven seats: five districts and six at-large', () => {
    expect(councilors).toHaveLength(11);
    expect(
      councilors
        .filter((c) => c.district !== null)
        .map((c) => c.district)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(councilors.filter((c) => c.seat === 'At-Large')).toHaveLength(6);
  });

  it('keeps names, titles, emails and photos', () => {
    expect(councilors[0]).toMatchObject({
      id: 'ma-worcester-joseph-petty',
      name: 'Joseph M. Petty',
      title: 'Mayor',
      email: 'mayor@worcesterma.gov',
      photo_url: 'https://www.worcesterma.gov/media/council/petty.jpg',
    });
    expect(councilors.find((c) => c.id === 'ma-worcester-khrystian-king')).toMatchObject({
      title: 'Vice Chair',
      email: 'KingK@worcesterma.gov',
    });
    // The page capitalises one name throughout.
    expect(councilors.find((c) => c.id === 'ma-worcester-kathleen-toomey')?.name).toBe('Kathleen M. Toomey');
    expect(councilors.find((c) => c.district === 2)?.name).toBe('Robert A. Bilotta');
  });

  it('makes ids from first and last names', () => {
    expect(worcesterOfficialId('Jose A. Rivera')).toBe('ma-worcester-jose-rivera');
    expect(worcesterOfficialId('Gary Rosen')).toBe('ma-worcester-gary-rosen');
  });
});

describe('Worcester committees', () => {
  const committees = parseWorcesterCommittees(fixture('committees.html'));

  it('reads the ten standing committees with chairs, vice-chairs and members', () => {
    expect(committees.length).toBeGreaterThanOrEqual(10);
    const econ = committees.find((c) => c.slug === 'economic-development');
    expect(econ?.members).toEqual([
      { name: 'Morris A. Bergman', role: 'Chair' },
      { name: 'Kathleen M. Toomey', role: 'Vice Chair' },
      { name: 'Satya B. Mitra', role: null },
    ]);
    expect(econ?.description).toMatch(
      /^Consists of three \(3\) councilors, to consider matters pertaining to economic/,
    );
    expect(committees.map((c) => c.name)).toContain("Veterans' Memorials, Parks and Recreation");
    for (const c of committees) expect(c.members).toHaveLength(3);
  });
});

describe('worcesterMeetingKind', () => {
  it('tells council meetings and committee meetings from other boards', () => {
    expect(worcesterMeetingKind('City Council')).toEqual({ committees: [], cancelled: false });
    expect(worcesterMeetingKind('Standing Committee on Public Works - CANCELLED')).toEqual({
      committees: ['Public Works'],
      cancelled: true,
    });
    expect(
      worcesterMeetingKind(
        'Standing Committee on Public Works (Meeting Jointly with Standing Committee on Traffic and Parking)',
      ).committees,
    ).toEqual(['Public Works', 'Traffic and Parking']);
    expect(worcesterMeetingKind('License Commission ').committees).toBeNull();
    expect(worcesterMeetingKind('Public Schools Standing Committee on Finance').committees).toBeNull();
  });

  it('finds the council meetings in a recorded PrimeGov list', () => {
    const meetings = JSON.parse(fixture('archived-2026.json')) as { title: string }[];
    const council = meetings.filter((m) => worcesterMeetingKind(m.title).committees !== null);
    expect(council.length).toBeGreaterThan(10);
    expect(meetings.some((m) => worcesterMeetingKind(m.title).committees === null)).toBe(true);
  });
});
