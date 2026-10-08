import { describe, expect, it } from 'vitest';
import { seatLayout } from '../components/viz/Hemicycle';
import { chamberGroups, pipeline, statusProgress } from './charts';

describe('charts', () => {
  it('lays out exactly one seat per member', () => {
    for (const n of [9, 40, 100, 160, 435]) expect(seatLayout(n).seats).toHaveLength(n);
  });

  it('counts voting seats by party with vacancies, leaving out delegates', () => {
    const members = [
      { current: true, chamber: 'senate' as const, party: 'D', state: 'MA' },
      { current: true, chamber: 'senate' as const, party: 'Independent', state: 'VT' },
      { current: true, chamber: 'house' as const, party: 'R', state: 'TX' },
      { current: true, chamber: 'house' as const, party: 'D', state: 'DC' },
      { current: false, chamber: 'house' as const, party: 'D', state: 'NY' },
    ];
    const senate = Object.fromEntries(chamberGroups(members, 'senate').map((g) => [g.label, g.seats]));
    expect(senate).toEqual({ Democrats: 1, Independents: 1, Vacant: 98, Republicans: 0 });
    const house = Object.fromEntries(chamberGroups(members, 'house').map((g) => [g.label, g.seats]));
    expect(house).toEqual({ Democrats: 0, Independents: 0, Vacant: 434, Republicans: 1 });
  });

  it('groups bills by stage and ignores simple resolutions', () => {
    const stages = pipeline([
      { status: 'introduced', bill_type: 'hr' },
      { status: 'passed_house', bill_type: 'hr' },
      { status: 'passed_senate', bill_type: 's' },
      { status: 'law', bill_type: 'hr' },
      { status: 'agreed', bill_type: 'hres' },
    ]);
    expect(Object.fromEntries(stages.map((s) => [s.label, s.value]))).toMatchObject({
      Introduced: 1,
      'Passed one chamber': 2,
      'Became law': 1,
    });
    expect(statusProgress('law')).toBe(1);
    expect(statusProgress('introduced')).toBeLessThan(statusProgress('passed_house'));
  });
});
