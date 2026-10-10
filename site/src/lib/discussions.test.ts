import { describe, expect, it } from 'vitest';
import { isAcceptingInput, meetsResidency } from './discussions';

const boston = { jurisdiction: 'ma-boston', district: 7, residency_required: true };

describe('discussion rules', () => {
  it('requires a saved address in the jurisdiction and district when residency is required', () => {
    expect(meetsResidency(boston, null)).toBe(false);
    expect(meetsResidency(boston, { state: 'MA', city: null, councilDistrict: null })).toBe(false);
    expect(meetsResidency(boston, { state: 'MA', city: 'ma-boston', councilDistrict: 4 })).toBe(false);
    expect(meetsResidency(boston, { state: 'MA', city: 'ma-boston', councilDistrict: 7 })).toBe(true);
    expect(meetsResidency({ ...boston, district: null }, { state: 'MA', city: 'ma-boston', councilDistrict: 4 })).toBe(
      true,
    );
    expect(
      meetsResidency(
        { jurisdiction: 'ma', district: null, residency_required: true },
        { state: 'NY', city: null, councilDistrict: null },
      ),
    ).toBe(false);
    expect(meetsResidency({ ...boston, residency_required: false }, null)).toBe(true);
  });

  it('accepts input only while open and inside its window', () => {
    const now = new Date('2026-10-08T12:00:00Z');
    expect(isAcceptingInput({ status: 'open', opens_at: null, closes_at: null }, now)).toBe(true);
    expect(isAcceptingInput({ status: 'closed', opens_at: null, closes_at: null }, now)).toBe(false);
    expect(isAcceptingInput({ status: 'open', opens_at: '2026-10-09T00:00:00Z', closes_at: null }, now)).toBe(false);
    expect(isAcceptingInput({ status: 'open', opens_at: null, closes_at: '2026-10-08T11:00:00Z' }, now)).toBe(false);
  });
});
