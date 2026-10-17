import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { opinionCounts, opinionLineup, separateOpinions } from '../src/federal/opinions.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/opinions/${name}`, import.meta.url), 'utf8');

describe('Supreme Court separate opinions', () => {
  it('reads each separate opinion from its heading in a slip opinion', () => {
    const list = separateOpinions(fixture('scotus-25-365-slip.txt'));
    expect(list).toEqual([
      { author: 'Jackson', kind: 'concurring', joined: ['Sotomayor'] },
      { author: 'Kavanaugh', kind: 'concurring in the judgment and dissenting in part', joined: [] },
      { author: 'Thomas', kind: 'dissenting', joined: ['Gorsuch'] },
      { author: 'Alito', kind: 'dissenting', joined: [] },
      { author: 'Gorsuch', kind: 'dissenting', joined: [] },
    ]);
    expect(opinionCounts(list)).toEqual({ concurrences: 1, dissents: 4 });
  });

  it('reads dissents from an order on an application', () => {
    expect(separateOpinions(fixture('scotus-26a124-order.txt'))).toEqual([
      { author: 'Sotomayor', kind: 'dissenting', joined: ['Kagan'] },
      { author: 'Jackson', kind: 'dissenting', joined: [] },
    ]);
  });

  it('reads title-case headings and the Chief Justice', () => {
    const text = [
      'Opinion of the Court',
      '',
      'Justice Gorsuch, concurring.',
      'I join the opinion of the Court in full.',
      '',
      'THE CHIEF JUSTICE, with whom JUSTICE ALITO and JUSTICE BARRETT join,',
      'dissenting.',
      'The Court errs.',
    ].join('\n');
    expect(separateOpinions(text)).toEqual([
      { author: 'Gorsuch', kind: 'concurring', joined: [] },
      { author: 'The Chief Justice', kind: 'dissenting', joined: ['Alito', 'Barrett'] },
    ]);
  });

  it('ignores a justice named in the middle of a sentence', () => {
    expect(
      separateOpinions('JUSTICE ALITO, JUSTICE KAVANAUGH’s exception is at war with his principle.\nMore text.'),
    ).toEqual([]);
    expect(separateOpinions(null)).toEqual([]);
  });

  it('keeps the syllabus lineup word for word, re-flowed', () => {
    expect(opinionLineup(fixture('scotus-25-365-slip.txt'))).toBe(
      'Roberts, C. J., delivered the opinion of the Court, in which Sotomayor, Kagan, Barrett, and Jackson, JJ., joined. Jackson, J., filed a concurring opinion, in which Sotomayor, J., joined as to the introduction and Part I. Kavanaugh, J., filed an opinion concurring in the judgment and dissenting in part. Thomas, J., filed a dissenting opinion, in which Gorsuch, J., joined. Alito, J., and Gorsuch, J., filed dissenting opinions.',
    );
  });

  it('mends a preliminary print: lost ligatures, page references, Roman numerals', () => {
    expect(opinionLineup(fixture('scotus-609-prelim-lineup.txt'))).toBe(
      'Roberts, C. J., delivered the opinion of the Court, in which Alito, Gorsuch, Kavanaugh, and Barrett, JJ., joined, and in which Thomas, J., joined as to all but Part III–B. Gorsuch, J., filed a concurring opinion. Sotomayor, J., filed a dissenting opinion, in which Kagan and Jackson, JJ., joined.',
    );
    expect(opinionLineup('PER CURIAM.\nThe application is denied.')).toBeNull();
  });
});
