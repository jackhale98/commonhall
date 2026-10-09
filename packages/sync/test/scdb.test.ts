import { describe, expect, it } from 'vitest';
import { caseCenteredCsvUrl, latestReleaseUrl, parseCsv, scdbOutcomeRows } from '../src/federal/scdb.ts';

const CSV = [
  '"caseId","term","docket","usCite","caseName","dateDecision","partyWinning","caseDisposition","decisionType","majVotes","minVotes","issue","issueArea"',
  '"2008-001",2008,"07-1","555 U.S. 1","OLD v. CASE",10/14/2008,1,3,1,9,0,10050,1',
  '"2025-068",2025,"25-748","","MCCARTHY v. HERNANDEZ",6/22/2026,1,4,2,6,3,20040,2',
  '"2025-069",2025,"25-1","","SMITH, ""JR."" v. JONES",6/30/2026,0,2,1,5,4,,',
].join('\r\n');

describe('SCDB', () => {
  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('maps case-centered rows from the first stored term on', () => {
    const rows = scdbOutcomeRows(CSV, '2026_01', 2009);
    expect(rows.map((r) => r.scdb_case_id)).toEqual(['2025-068', '2025-069']);
    expect(rows[0]).toMatchObject({
      term: 2025,
      docket: '25-748',
      us_cite: null,
      date_decision: '2026-06-22',
      party_winning: 1,
      case_disposition: 4,
      maj_votes: 6,
      min_votes: 3,
      issue: 20040,
      issue_area: 2,
      release: '2026_01',
    });
    expect(rows[1]!.case_name).toBe('SMITH, "JR." v. JONES');
    expect(rows[1]).toMatchObject({ issue: null, issue_area: null });
  });

  it('refuses a file without the case-centered columns', () => {
    expect(() => scdbOutcomeRows('"justice","vote"\n1,2', 'x')).toThrow(/case-centered/);
  });

  it('finds the newest release and its case-centered CSV by citation', () => {
    expect(latestReleaseUrl('<a href="/data/2025-release-01/">x</a><a href="/data/2026-release-01/">y</a>')).toEqual({
      release: '2026_01',
      url: 'https://scdb.la.psu.edu/data/2026-release-01/',
    });
    const html = [
      '<a class="jet-download" href="https://scdb.la.psu.edu/?jet_download=aaa"><span>Download CSV</span></a>',
      '<p>Organized by Docket</p>',
      '<a class="jet-download" href="https://scdb.la.psu.edu/?jet_download=bbb"> <span>Download CSV</span> </a>',
      '<p>Organized by Supreme Court Citation</p>',
      '<a class="jet-download" href="https://scdb.la.psu.edu/?jet_download=ccc"><span>Download CSV</span></a>',
      '<p>Organized by Supreme Court Citation</p>',
    ].join('');
    expect(caseCenteredCsvUrl(html)).toBe('https://scdb.la.psu.edu/?jet_download=bbb');
  });
});
