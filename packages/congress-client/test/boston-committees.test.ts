import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { committeeSlug, committeesFromLocation } from '../src/boston-committees.ts';

describe('committeesFromLocation', () => {
  it('reads the committee and settles its spelling', () => {
    expect(committeesFromLocation('Ways & Means Committee Hearing on Dockets #1829-1838')).toEqual(['Ways and Means']);
    expect(committeesFromLocation('Ways and Means Committee Hearing on Docket #0586')).toEqual(['Ways and Means']);
    expect(committeesFromLocation('Ways & Means Public Testimony on Dockets #1671-1674')).toEqual(['Ways and Means']);
    expect(committeesFromLocation('Planning Development & Transportation Committee Hearing on Dockets #1')).toEqual([
      'Planning, Development, and Transportation',
    ]);
    expect(committeesFromLocation('City Services Committee Hearing on Docket #0773')).toEqual([
      'City Services and Innovation Technology',
    ]);
    expect(committeesFromLocation('Committee of the Whole Hearing on Dockets #0001')).toEqual([
      'Committee of the Whole',
    ]);
  });

  it('splits joint hearings', () => {
    expect(
      committeesFromLocation(
        'Public Safety & Criminal Justice and Public Health, Homelessness, & Recovery Joint Committee Hearing on Dockets #1',
      ).sort(),
    ).toEqual(['Public Health, Homelessness, and Recovery', 'Public Safety and Criminal Justice']);
    expect(
      committeesFromLocation(
        'Post-Audit and Planning, Development & Transportation Joint Committee Hearing on Dockets #2',
      ).sort(),
    ).toEqual([
      'Planning, Development, and Transportation',
      'Post-Audit: Government Accountability, Transparency, and Accessibility',
    ]);
  });

  it('leaves full council meetings alone', () => {
    expect(committeesFromLocation('Council Chambers')).toEqual([]);
    expect(committeesFromLocation(null)).toEqual([]);
  });

  it('knows every committee in the recorded Legistar meetings', () => {
    const events = JSON.parse(
      readFileSync(new URL('./fixtures/legistar/events-committees.json', import.meta.url), 'utf8'),
    ) as { EventLocation: string | null }[];
    const names = new Set(events.flatMap((e) => committeesFromLocation(e.EventLocation)));
    expect(names.size).toBeGreaterThan(15);
    // Every spelling lands on a listed name (no stray "&" variants).
    for (const n of names) expect(n).not.toContain('&');
    expect(committeeSlug('Rules, Ethics, and Administration')).toBe('rules-ethics-and-administration');
  });
});
