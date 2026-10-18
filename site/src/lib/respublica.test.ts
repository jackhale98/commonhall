import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clauseLinks, constitutionIndex } from './respublica';

/** Res Publica's /data/refs.json (recorded October 2026): the Constitution's and amendments' refs and a few others. */
const refs = JSON.parse(
  readFileSync(
    new URL('../../../packages/congress-client/test/fixtures/respublica/refs.json', import.meta.url),
    'utf8',
  ),
) as Record<string, { label: string; url: string }>;

describe('Res Publica clause links', () => {
  it('keep the Constitution’s and amendments’ refs, with links on respublicalibrary.org', () => {
    const index = constitutionIndex(refs);
    expect(index['Constitution.1.8.3']).toEqual({
      label: 'Article I, Section 8, Clause 3',
      url: 'https://respublicalibrary.org/constitution/#Constitution.1.8.3',
    });
    expect(index['Federalist.10']).toBeUndefined();
    expect(Object.keys(index).length).toBe(191);
  });

  it('drop links that leave the library, and refuse an index that changed shape', () => {
    const index = constitutionIndex({
      ...refs,
      'Constitution.1.8.3': { label: 'Commerce', url: 'https://example.com/x' },
      'Constitution.1.8.4': { label: 'Naturalization', url: 'javascript:alert(1)' },
    });
    expect(index['Constitution.1.8.3']).toBeUndefined();
    expect(index['Constitution.1.8.4']).toBeUndefined();
    expect(() => constitutionIndex({ 'Constitution.1': { label: 'Article I', url: '/constitution/' } })).toThrow(
      /expected at least/,
    );
    expect(() => constitutionIndex([])).toThrow(/not an object/);
  });

  it('link each cited ref to the nearest provision the library has, once', () => {
    const index = constitutionIndex(refs);
    expect(clauseLinks(['Constitution.1.8.3', 'Constitution.1.8.18'], index).map((l) => l.label)).toEqual([
      'Article I, Section 8, Clause 3',
      'Article I, Section 8, Clause 18',
    ]);
    // Article I, Section 8 has no clause 40: its section instead, listed once.
    expect(clauseLinks(['Constitution.1.8.40', 'Constitution.1.8'], index).map((l) => l.ref)).toEqual([
      'Constitution.1.8',
    ]);
    expect(clauseLinks(['Amendment.16'], index)[0]!.label).toBe('Amendment XVI');
    expect(clauseLinks(['Constitution.1.8'], null)).toEqual([]);
    expect(clauseLinks(null, index)).toEqual([]);
  });
});
