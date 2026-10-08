import { describe, expect, it } from 'vitest';
import { maLegislatureUrl, slug, stateBillHref } from './paths';

describe('state bill paths', () => {
  it('builds clean URLs from session and identifier', () => {
    expect(slug('H 1234')).toBe('h-1234');
    expect(slug('2025-2026 Regular Session')).toBe('2025-2026-regular-session');
    expect(stateBillHref('MA', '194th', 'H 1234')).toBe('/states/ma/bills/194th/h-1234/');
  });

  it('links Massachusetts bills to malegislature.gov', () => {
    expect(maLegislatureUrl('194th', 'H 1234')).toBe('https://malegislature.gov/Bills/194/H1234');
    expect(maLegislatureUrl('194th', 'SD 56')).toBe('https://malegislature.gov/Bills/194/SD56');
    expect(maLegislatureUrl('194th', 'Order 3')).toBeNull();
    expect(maLegislatureUrl('special', 'H 1')).toBeNull();
  });
});
