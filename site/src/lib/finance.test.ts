import { describe, expect, it } from 'vitest';
import { formatMoney } from './finance';

describe('formatMoney', () => {
  it('rounds to K, M and B and signs reductions', () => {
    expect(formatMoney(4_470_029_155)).toBe('$4.47B');
    expect(formatMoney(65_000_000)).toBe('$65M');
    expect(formatMoney(3_159_760)).toBe('$3.2M');
    expect(formatMoney(102_193)).toBe('$102K');
    expect(formatMoney(-209_162)).toBe('−$209K');
    expect(formatMoney(null)).toBe('—');
    // Halves round up, consistently.
    expect(formatMoney(2_150_000)).toBe('$2.2M');
    expect(formatMoney(12_500_000)).toBe('$13M');
    expect(formatMoney(2_250_000)).toBe('$2.3M');
  });
});
