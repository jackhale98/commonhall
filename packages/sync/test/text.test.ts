import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pickShortTitle, pickTextUrl } from '../src/federal/bills.ts';
import { buildMemberRows } from '../src/federal/members.ts';
import { directOrder, htmlToText, nameFromFullName, partyCode, stateCode, toDate, toTimestamp } from '../src/text.ts';

describe('htmlToText', () => {
  it('keeps paragraphs and list items, drops tags, decodes entities', () => {
    expect(
      htmlToText('<p><strong>Act</strong></p> <p>Tax &amp; &#8220;health&#8221;</p><ul><li>One</li><li>Two</li></ul>'),
    ).toBe('Act\n\nTax & “health”\n• One\n• Two');
    expect(htmlToText('')).toBeNull();
    expect(htmlToText('<p> </p>')).toBeNull();
  });

  it('never lets markup through', () => {
    expect(htmlToText('<script>alert(1)</script><p>ok</p><style>p{}</style>')).toBe('ok');
  });
});

describe('names, states and parties', () => {
  it('formats names', () => {
    expect(directOrder('Wahab, Aisha')).toBe('Aisha Wahab');
    expect(nameFromFullName('Rep. Foxx, Virginia [R-NC-5]')).toBe('Virginia Foxx');
    expect(nameFromFullName('Sen. Warren, Elizabeth [D-MA]')).toBe('Elizabeth Warren');
  });

  it('normalises states and parties', () => {
    expect(stateCode('California')).toBe('CA');
    expect(stateCode('District of Columbia')).toBe('DC');
    expect(stateCode('tx')).toBe('TX');
    expect(stateCode('Narnia')).toBeNull();
    expect(partyCode('Democratic')).toBe('D');
    expect(partyCode('Republican')).toBe('R');
    expect(partyCode('Independent')).toBe('I');
    expect(partyCode('ID')).toBe('I');
  });

  it('normalises dates', () => {
    expect(toDate('2025-07-04T12:00:00Z')).toBe('2025-07-04');
    expect(toTimestamp('2026-10-08')).toBe('2026-10-08T00:00:00.000Z');
    expect(toTimestamp('2025-01-16T11:00:00-05:00')).toBe('2025-01-16T16:00:00.000Z');
    expect(toTimestamp('garbage')).toBeNull();
  });
});

describe('bill field pickers', () => {
  it('prefers the enacted short title', () => {
    expect(
      pickShortTitle([
        { title: 'Introduced Name Act', titleType: 'Short Titles as Introduced' },
        { title: 'Final Name Act', titleType: 'Short Titles as Enacted' },
        { title: 'An act to do things.', titleType: 'Official Title as Enacted' },
      ]),
    ).toBe('Final Name Act');
    expect(pickShortTitle([{ title: 'An act.', titleType: 'Official Title as Introduced' }])).toBeNull();
  });

  it('ignores short titles for portions of a bill (recorded H.R. 1, 119th Congress)', () => {
    const { titles } = JSON.parse(
      readFileSync(
        new URL('../../congress-client/test/fixtures/congress/bill-hr1-titles.json', import.meta.url),
        'utf8',
      ),
    );
    expect(pickShortTitle(titles)).toBe('One Big Beautiful Bill Act');
    // Only portion titles: still better than none.
    expect(
      pickShortTitle([{ title: 'Part Act', titleType: 'Short Titles as Enacted for portions of this bill' }]),
    ).toBe('Part Act');
  });

  it('links the newest text version, HTML first', () => {
    expect(
      pickTextUrl([
        { date: '2025-01-01T00:00:00Z', formats: [{ type: 'Formatted Text', url: 'old.htm' }] },
        {
          date: '2025-06-01T00:00:00Z',
          formats: [
            { type: 'PDF', url: 'new.pdf' },
            { type: 'Formatted Text', url: 'new.htm' },
          ],
        },
      ]),
    ).toBe('new.htm');
    expect(pickTextUrl([])).toBeNull();
  });
});

describe('buildMemberRows', () => {
  it('merges Congress.gov and congress-legislators data', () => {
    const rows = buildMemberRows(
      [
        {
          bioguideId: 'C000127',
          name: 'Cantwell, Maria',
          partyName: 'Democratic',
          state: 'Washington',
          terms: { item: [{ chamber: 'Senate', startYear: 2001 }] },
          depiction: { imageUrl: 'https://www.congress.gov/img/member/c000127_200.jpg' },
          updateDate: '2026-01-01T00:00:00Z',
        },
        {
          bioguideId: 'X000001',
          name: 'Example, Pat',
          partyName: 'Independent',
          state: 'Alaska',
          terms: { item: [{ chamber: 'House of Representatives', startYear: 2025 }] },
          updateDate: '2026-01-01T00:00:00Z',
        },
      ],
      new Set(['C000127']),
      [
        {
          bioguideId: 'C000127',
          lisId: 'S275',
          name: 'Maria Cantwell',
          chamber: 'senate',
          state: 'WA',
          district: null,
          party: 'Democrat',
          website: 'https://www.cantwell.senate.gov',
          phone: '202-224-3441',
          office: '511 Hart Senate Office Building',
          contactForm: null,
          fecCandidateId: 'S8WA00194',
          nextElection: 2030,
        },
      ],
      [{ id: { bioguide: 'C000127' }, social: { twitter: 'SenatorCantwell' } }],
    );
    expect(rows[0]).toMatchObject({
      bioguide_id: 'C000127',
      name: 'Maria Cantwell',
      chamber: 'senate',
      state: 'WA',
      district: null,
      party: 'D',
      lis_id: 'S275',
      current: true,
      social: { twitter: 'https://x.com/SenatorCantwell' },
      fec_candidate_id: 'S8WA00194',
      next_election: 2030,
    });
    // At-large House member with no district in the list: stored as 0.
    expect(rows[1]).toMatchObject({ name: 'Pat Example', chamber: 'house', district: 0, current: false, party: 'I' });
  });
});
