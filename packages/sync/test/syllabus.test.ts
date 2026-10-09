import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { htmlText, syllabusOpinionId } from '../src/federal/court.ts';
import { syllabusBackground } from '../src/federal/syllabus.ts';

/** Text of real slip opinions (supremecourt.gov PDFs, first pages, `pdftotext -layout`). */
const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/syllabus/${name}`, import.meta.url)), 'utf8');

describe('syllabus background', () => {
  it('takes the text between the docket line and "Held:", word for word', () => {
    const s = syllabusBackground(fixture('24-43-slip-layout.txt'))!;
    expect(s.startsWith('The question before the Court in these cases is whether, under Title IX')).toBe(true);
    expect(s).toContain('In 2021, West Virginia enacted the Save Women’s Sports Act');
    expect(s).not.toMatch(/Held:|Syllabus|OCTOBER TERM|NOTE: Where it is feasible|Together with No\./);
    // Real compounds keep their hyphen; typesetting hyphens and split section numbers are rejoined.
    expect(s).toContain('cross-country and track-and-field teams');
    expect(s).toContain('necessary to promote');
    expect(s).toContain('§§33–6202(1)–(5)');
  });

  it('keeps a compound split at the line end', () => {
    const s = syllabusBackground(fixture('24-621-slip-layout.txt'))!;
    expect(s).toContain('upheld those coordinated-expenditure limits');
    expect(s.endsWith('This Court granted certiorari.')).toBe(true);
  });

  it('refuses text with lost ligatures rather than publish "fled" for "filed"', () => {
    expect(syllabusBackground(fixture('23-929-preliminary-print-layout.txt'))).toBeNull();
  });

  it('returns null without a syllabus', () => {
    expect(syllabusBackground('PER CURIAM. The petition for a writ of certiorari is granted.')).toBeNull();
    expect(syllabusBackground(null)).toBeNull();
  });
});

describe('opinion text', () => {
  it('reads the combined or lead opinion first', () => {
    expect(syllabusOpinionId([1, 2, 3], ['dissent', 'lead-opinion', 'concurrence-opinion'])).toBe(2);
    expect(syllabusOpinionId([7], ['unknown'])).toBe(7);
    expect(syllabusOpinionId([], [])).toBeNull();
  });

  it('turns CourtListener HTML into text', () => {
    expect(htmlText('<pre class="inline">A &amp; B<br>C</pre>')).toBe('A & B\nC\n');
  });
});
