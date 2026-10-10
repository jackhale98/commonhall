import { describe, expect, it } from 'vitest';
import { ctLegislatureUrl, maLegislatureUrl, slug, stateBillHref, stateOrderHref, stateOrderId } from './paths';

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

  it('links Connecticut bills to their status page on cga.ct.gov', () => {
    const page = 'https://www.cga.ct.gov/asp/cgabillstatus/cgabillstatus.asp?selBillType=Bill';
    expect(ctLegislatureUrl('2026', 'HB 5001')).toBe(`${page}&which_year=2026&bill_num=5001`);
    expect(ctLegislatureUrl('2026', 'SB 1')).toBe(`${page}&which_year=2026&bill_num=1`);
    expect(ctLegislatureUrl('2025', 'SB 0012')).toBe(`${page}&which_year=2025&bill_num=12`);
    expect(ctLegislatureUrl('2026', 'HJ 1')).toBeNull();
    expect(ctLegislatureUrl('2025S1', 'HB 7001')).toBeNull();
  });
});

describe('governor order paths', () => {
  it('addresses an order by its label', () => {
    expect(stateOrderId('MA', '635')).toBe('ma-635');
    expect(stateOrderId('CT', '7OOO')).toBe('ct-7ooo');
    expect(stateOrderHref('ma-635')).toBe('/states/ma/governor/635/');
    expect(stateOrderHref('ct-26-3')).toBe('/states/ct/governor/26-3/');
  });
});
