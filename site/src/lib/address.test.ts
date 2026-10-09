import { describe, expect, it } from 'vitest';
import { areaLabel } from './address';

describe('areaLabel', () => {
  it('keeps city, state and ZIP, never the street', () => {
    expect(areaLabel('1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500')).toBe('Washington, DC 20500');
    expect(areaLabel('1100 CONGRESS AVE, AUSTIN, TX, 78701')).toBe('Austin, TX 78701');
    expect(areaLabel('PO BOX 5, BOSTON, MA, 02108-1234')).toBe('Boston, MA 02108');
    expect(areaLabel('68 Theodore Parker Rd, Boston, MA')).toBe('Boston, MA');
    expect(areaLabel('Washington, DC 20500')).toBe('Washington, DC 20500');
  });

  it('keeps nothing when the street cannot be told apart', () => {
    expect(areaLabel('123 Main St')).toBeNull();
    expect(areaLabel('')).toBeNull();
    expect(areaLabel(null)).toBeNull();
  });
});
