import { describe, expect, it } from 'vitest';
import type { SavedDistricts } from './auth';
import { isMine } from './pinned';

const saved: SavedDistricts = {
  state: 'MA',
  congressional_district: 7,
  state_upper_district: '2nd Suffolk',
  state_lower_district: '11th Suffolk',
  city: 'ma-boston',
  council_district: 6,
};

describe('isMine', () => {
  it('matches senators and the House member for the saved district', () => {
    const scope = { kind: 'congress', state: 'MA' } as const;
    expect(isMine({ chamber: 'senate', district: null }, scope, saved)).toBe(true);
    expect(isMine({ chamber: 'house', district: 7 }, scope, saved)).toBe(true);
    expect(isMine({ chamber: 'house', district: 8 }, scope, saved)).toBe(false);
    expect(isMine({ chamber: 'senate', district: null }, { kind: 'congress', state: 'NY' }, saved)).toBe(false);
  });

  it('matches state legislators by chamber and district name', () => {
    const scope = { kind: 'legislature', state: 'MA' } as const;
    expect(isMine({ chamber: 'upper', district: '2nd Suffolk' }, scope, saved)).toBe(true);
    expect(isMine({ chamber: 'lower', district: '11th Suffolk' }, scope, saved)).toBe(true);
    expect(isMine({ chamber: 'lower', district: '2nd Suffolk' }, scope, saved)).toBe(false);
  });

  it('matches the district councilor and every at-large councilor', () => {
    const scope = { kind: 'council', city: 'ma-boston' } as const;
    expect(isMine({ district: 6 }, scope, saved)).toBe(true);
    expect(isMine({ district: null }, scope, saved)).toBe(true);
    expect(isMine({ district: 5 }, scope, saved)).toBe(false);
    expect(isMine({ district: null }, { kind: 'council', city: 'ma-worcester' }, saved)).toBe(false);
  });
});
