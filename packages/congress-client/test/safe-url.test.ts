import { describe, expect, it } from 'vitest';
import { safeNext, safeUrl } from '../src/safe-url.ts';

describe('safeUrl', () => {
  it('keeps http and https links', () => {
    expect(safeUrl('https://malegislature.gov/Bills/194/H1')).toBe('https://malegislature.gov/Bills/194/H1');
    expect(safeUrl(' http://example.org/a b ')).toBe('http://example.org/a%20b');
  });

  it('drops other schemes, junk and empty values', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeUrl('vbscript:x')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });

  it('resolves a relative link against a base', () => {
    expect(safeUrl('/doc/x.pdf', 'https://www.mass.gov/')).toBe('https://www.mass.gov/doc/x.pdf');
    expect(safeUrl('javascript:alert(1)', 'https://www.mass.gov/')).toBeNull();
  });
});

describe('safeNext', () => {
  const origin = 'https://commonhall.org';

  it('keeps a path on this site', () => {
    expect(safeNext('/bills/119/hr/1/?tab=votes#x', origin)).toBe('/bills/119/hr/1/?tab=votes#x');
  });

  it('refuses anything that leaves the site', () => {
    expect(safeNext('/\\evil.com', origin)).toBeNull();
    expect(safeNext('//evil.com/path', origin)).toBeNull();
    expect(safeNext('/\\/evil.com', origin)).toBeNull();
    expect(safeNext('https://evil.com', origin)).toBeNull();
    expect(safeNext('javascript:alert(1)', origin)).toBeNull();
    expect(safeNext('', origin)).toBeNull();
    expect(safeNext(null, origin)).toBeNull();
  });
});
