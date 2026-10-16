import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  electionDay,
  htmlText,
  maBallotQuestionCount,
  maBallotQuestionUrl,
  parseMaBallotQuestion,
} from '../src/ma-ballot.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/ma-ballot/${name}`, import.meta.url), 'utf8');

describe('Massachusetts Information for Voters', () => {
  it('reads how many statewide questions the guide has', () => {
    expect(maBallotQuestionCount(fixture('index.html'))).toBe(9);
    expect(maBallotQuestionCount('<p>Nothing here</p>')).toBeNull();
  });

  it('builds question page addresses', () => {
    expect(maBallotQuestionUrl(2026, 3)).toBe(
      'https://www.sec.state.ma.us/divisions/elections/research-and-statistics/2026-information-for-voters/2026-ballot-question3.htm',
    );
  });

  it('finds Election Day', () => {
    expect(electionDay(2026)).toBe('2026-11-03');
    expect(electionDay(2024)).toBe('2024-11-05');
    expect(electionDay(2022)).toBe('2022-11-08');
  });

  it('keeps line breaks and decodes entities', () => {
    expect(htmlText('A&nbsp;&amp;\n  B<br>\nC &#8212; D')).toBe('A & B\nC — D');
  });

  it('parses every section of a question', () => {
    const q = parseMaBallotQuestion(fixture('question1.html'));
    expect(q).toMatchObject({
      number: 1,
      kind: 'Law Proposed by Initiative Petition',
      title: 'Expanding the Public Records Law',
    });
    expect(q.question).toMatch(/^Do you approve of a law summarized below/);
    expect(q.summary).toHaveLength(1);
    expect(q.yesVote).toMatch(/^A YES VOTE would make most records/);
    expect(q.noVote).toMatch(/^A NO VOTE would make no change/);
    expect(q.fiscal[0]).toMatch(/no discernible material fiscal consequences/);
    expect(q.argumentFor?.text).toHaveLength(4);
    expect(q.argumentFor?.authors).toEqual([
      'Diana DiZoglio',
      'Committee for Transparency and Democracy',
      'www.dianaforma.com/ballot',
    ]);
    // No organized opposition: the Secretary's note comes first, then the argument.
    expect(q.argumentAgainst?.text[0]).toMatch(/^As of the printing of this publication/);
    expect(q.reports.map((r) => r.title)).toEqual(['Majority Report', 'Minority Report']);
    expect(q.fullText[0]).toBe('An Act to improve access to public records.');
    expect(Object.keys(q.notes).sort()).toEqual(['arguments', 'fiscal', 'reports', 'summary', 'vote']);
    expect(q.notes.summary).toMatch(/^As required by law, summaries are written by the State Attorney General/);
  });

  it('reads paragraphs that are bare text between blank lines', () => {
    const q = parseMaBallotQuestion(fixture('question2.html'));
    expect(q.argumentFor?.text).toHaveLength(4);
    expect(q.argumentFor?.text[0]).toMatch(/^A YES vote will give employees/);
    // Street address, "c/o" line and phone number left out.
    expect(q.argumentFor?.authors).toEqual(['Tom McKeever', 'Labor Unions for Public Counsel Workers Rights']);
    expect(q.notes.arguments).toMatch(/^As provided by law, the 150-word arguments/);
  });

  it('finds an authors block without its label, and keeps list items as bullets', () => {
    const q = parseMaBallotQuestion(fixture('question6.html'));
    expect(q.argumentFor?.authors).toEqual(['Mass Audubon', 'www.natureforma.org']);
    expect(q.argumentFor?.text).toContain('• Protect clean drinking water');
    expect(q.argumentFor?.text.at(-1)).toMatch(/^Massachusetts is home to beautiful natural areas/);
  });

  it('fails on a page without the guide layout', () => {
    expect(() => parseMaBallotQuestion('<h1>Page not found</h1>')).toThrow(/no "Question N" heading/);
    const gutted = fixture('question1.html').replace(/<h2>Summary<\/h2>[\s\S]*?<h2>/, '<h2>');
    expect(() => parseMaBallotQuestion(gutted)).toThrow(/missing summary/);
  });
});
