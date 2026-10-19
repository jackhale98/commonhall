import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authorityText, constitutionRefs, numberOf } from '../src/federal/authority.ts';

/**
 * Constitutional authority statements as the Congressional Record prints them (and
 * Congress.gov returns them as constitutionalAuthorityStatementText): one of each
 * wording found in the Records of January 16, April 29 and July 22, 2025 and March 4,
 * 2026 (GovInfo CREC packages).
 */
const statements = JSON.parse(
  readFileSync(
    new URL('../../congress-client/test/fixtures/congress/authority-statements.json', import.meta.url),
    'utf8',
  ),
) as { bill: string; text: string }[];
const refsFor = (bill: string) => constitutionRefs(statements.find((s) => s.bill === bill)!.text);

describe('constitutional authority statements', () => {
  it('read the authority, not the Record’s header or the single subject', () => {
    const text = authorityText(statements.find((s) => s.bill === 'H.R. 482')!.text);
    expect(text).toBe('Article 1, section 8');
    expect(
      authorityText(
        'Congress has the power to enact this legislation pursuant to the following: Article I, Section 8 [[Page H10]] The single subject of this legislation is: Section 2 of the Act.',
      ),
    ).toBe('Article I, Section 8');
  });

  it('give a ref for nearly every recorded statement', () => {
    const none = statements.filter((s) => constitutionRefs(s.text).length === 0);
    // "Title 1, Section 8" and a statement that only quotes the clause's words.
    expect(none.length).toBeLessThanOrEqual(2);
    for (const s of statements)
      for (const ref of constitutionRefs(s.text))
        expect(ref).toMatch(/^(Constitution\.[1-7](\.\d+){0,2}|Amendment\.\d+(\.\d+)?)$/);
  });

  it('read every wording of a provision, in any order', () => {
    const cases: [string, string[]][] = [
      ['Article I, Section 8', ['Constitution.1.8']],
      ['Article One, Section Eight', ['Constitution.1.8']],
      ['Section VIII of Article I of the U.S. Constitution', ['Constitution.1.8']],
      ['U.S. Const., Art. 1, Sec. 8', ['Constitution.1.8']],
      ['Clause 18 of section 8 of Article I of the Constitution.', ['Constitution.1.8.18']],
      ['Clause 3, Section 8, Article 1 of the Constitution', ['Constitution.1.8.3']],
      ['According to Article 1: Section 8: Clause 18: of the United States Constitution', ['Constitution.1.8.18']],
      ['Art. 1 Sec. 8 Clause 18', ['Constitution.1.8.18']],
      [
        'clauses 1, 14 and 18 of section 8 of Article I.',
        ['Constitution.1.8.1', 'Constitution.1.8.14', 'Constitution.1.8.18'],
      ],
      ['Article I, Section 8, Clause 12 & 13 (Military Powers)', ['Constitution.1.8.12', 'Constitution.1.8.13']],
      [
        'the General Welfare Clause (Art. 1 Sec. 8 Cl. 1), the Commerce Clause (Art. 1 Sec. 8 CL. 3)',
        ['Constitution.1.8.1', 'Constitution.1.8.3'],
      ],
      ['Article I Section 8 and Amendment XVI', ['Constitution.1.8', 'Amendment.16']],
      ['Section 5 of the Fourteenth Amendment', ['Amendment.14.5']],
      ['the 14th Amendment, section 5', ['Amendment.14.5']],
      ['the Twenty-first Amendment', ['Amendment.21']],
      ['Article VI, Clause 2', ['Constitution.6.2']],
      ['Article V of the Constitution', ['Constitution.5']],
    ];
    for (const [text, refs] of cases) expect(constitutionRefs(text), text).toEqual(refs);
  });

  it('go no further than the sponsor numbered', () => {
    // A clause with no section, or a section with no number, falls back to the article.
    expect(constitutionRefs('Article 1, Clause 8')).toEqual(['Constitution.1']);
    expect(constitutionRefs('Clause 18 of Section of Article 1')).toEqual(['Constitution.1']);
    // Clause names aren't numbers, and other laws' sections aren't the Constitution's.
    expect(constitutionRefs('the Commerce Clause and the Necessary and Proper Clause')).toEqual([]);
    expect(constitutionRefs('Article I, Section 8, Clause 3 and the Spending Clause')).toEqual(['Constitution.1.8.3']);
    expect(constitutionRefs('Title 1, Section 8')).toEqual([]);
    expect(constitutionRefs(null)).toEqual([]);
  });

  it('match the recorded statements by bill', () => {
    expect(refsFor('H.R. 482')).toEqual(['Constitution.1.8']);
    expect(statements.some((s) => constitutionRefs(s.text).includes('Constitution.1.8.18'))).toBe(true);
  });

  it('read numbers in figures, Roman numerals and words', () => {
    expect([numberOf('8'), numberOf('VIII'), numberOf('xiv'), numberOf('Eight'), numberOf('fourteenth')]).toEqual([
      8, 8, 14, 8, 14,
    ]);
    expect([numberOf('14th'), numberOf('twenty-seventh'), numberOf('of')]).toEqual([14, 27, null]);
  });

  it('read the statement as Congress.gov returns it with a bill (recorded October 2026)', () => {
    const { bill } = JSON.parse(
      readFileSync(new URL('../../congress-client/test/fixtures/congress/bill-hr482.json', import.meta.url), 'utf8'),
    ) as { bill: { constitutionalAuthorityStatementText?: string } };
    // The Record's text in a <pre>, with a link to gpo.gov in its header.
    expect(bill.constitutionalAuthorityStatementText).toMatch(/^<pre>/);
    expect(authorityText(bill.constitutionalAuthorityStatementText)).toBe('Article 1, section 8');
    expect(constitutionRefs(bill.constitutionalAuthorityStatementText)).toEqual(['Constitution.1.8']);
  });
});
