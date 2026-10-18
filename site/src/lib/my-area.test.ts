import { describe, expect, it } from 'vitest';
import { parseArea } from './my-area';

describe('parseArea', () => {
  it('reads a remembered area', () => {
    const area = {
      label: 'Boston, MA 02201',
      state: 'MA',
      congressional_district: 8,
      state_upper_district: 'Third Suffolk',
      state_lower_district: '3rd Suffolk',
      city: 'ma-boston',
      council_district: 1,
    };
    expect(parseArea(JSON.stringify(area))).toEqual(area);
  });

  it('drops anything else, such as a street address', () => {
    const parsed = parseArea(JSON.stringify({ state: 'CT', street: '1 Main St', congressional_district: 1 }));
    expect(parsed).toEqual({
      label: null,
      state: 'CT',
      congressional_district: 1,
      state_upper_district: null,
      state_lower_district: null,
      city: null,
      council_district: null,
    });
    expect(JSON.stringify(parsed)).not.toContain('Main');
  });

  it('refuses a missing or malformed value', () => {
    expect(parseArea(null)).toBeNull();
    expect(parseArea('not json')).toBeNull();
    expect(parseArea(JSON.stringify({ state: 'Massachusetts' }))).toBeNull();
    expect(parseArea(JSON.stringify({ congressional_district: 8 }))).toBeNull();
  });
});
