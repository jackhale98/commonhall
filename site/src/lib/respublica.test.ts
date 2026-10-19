import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCDB_PROVISIONS, caseIndex, caseProvision, clauseLinks, constitutionIndex } from './respublica';

/** Res Publica's /data/refs.json (recorded October 2026): the Constitution's and amendments' refs, its landmark cases (by CourtListener cluster ID) and a few others. */
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

describe('Res Publica and the Supreme Court', () => {
  it('link every constitutional provision SCDB codes to a ref the library has', () => {
    const index = constitutionIndex(refs);
    for (const [code, [ref]] of Object.entries(SCDB_PROVISIONS)) expect(index[ref], `${code} ${ref}`).toBeDefined();
    expect(caseProvision(203, index)).toEqual({
      description: 'First Amendment (establishment of religion)',
      link: { ref: 'Amendment.1', label: 'Amendment I', url: 'https://respublicalibrary.org/amendments/#Amendment.1' },
    });
    // A statute (the Administrative Procedure Act) is not a clause; no code, nothing.
    expect(caseProvision(305, index)).toBeNull();
    expect(caseProvision(null, index)).toBeNull();
    // Without the library's index the provision is still named, unlinked.
    expect(caseProvision(111, null)).toEqual({
      description: 'Article I, Section 8, Paragraph 3 (interstate commerce clause)',
      link: null,
    });
  });

  it('find the library’s landmark cases by CourtListener cluster ID', () => {
    const cases = caseIndex(refs);
    expect(cases[6481357]).toEqual({
      label: 'Dobbs v. Jackson Women’s Health Organization (2022)',
      url: 'https://respublicalibrary.org/cases/6481357/',
    });
    expect(Object.keys(cases).length).toBe(232);
    expect(() => caseIndex({ 'Case.1': { label: 'One', url: '/cases/1/' } })).toThrow(/1 cases/);
  });
});
