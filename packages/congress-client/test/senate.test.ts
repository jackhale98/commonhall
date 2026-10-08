import { describe, expect, it } from 'vitest';
import {
  SenateClient,
  easternOffset,
  menuUrl,
  parseSenateDate,
  parseSenateMenu,
  parseSenateVote,
  senateDocTypeToBillType,
  voteUrl,
} from '../src/senate.ts';
import { fixture, replayFetch } from './helpers.ts';

describe('parseSenateVote', () => {
  const vote = parseSenateVote(fixture('senate/vote_119_1_00001.xml'));

  it('reads the header', () => {
    expect(vote).toMatchObject({
      congress: 119,
      session: 1,
      rollNumber: 1,
      question: 'On Cloture on the Motion to Proceed',
      result: 'Cloture on the Motion to Proceed Agreed to',
      majorityRequirement: '3/5',
      date: '2025-01-09T14:54:00-05:00',
    });
    expect(vote.document).toMatchObject({ type: 'S.', number: '5', name: 'S. 5', congress: 119 });
  });

  it('counts positions and validates them against the summary in the same file', () => {
    expect(vote.members).toHaveLength(99);
    expect(vote.totals).toEqual({ yea: 84, nay: 9, present: 0, notVoting: 6 });
    expect(vote.totalsMatchCount).toBe(true);
    expect(vote.members[0]).toMatchObject({
      lisId: 'S428',
      lastName: 'Alsobrooks',
      party: 'D',
      state: 'MD',
      position: 'yea',
    });
  });

  it('flags a file whose members disagree with its count', () => {
    const tampered = fixture('senate/vote_119_1_00001.xml').replace('<yeas>84</yeas>', '<yeas>85</yeas>');
    expect(parseSenateVote(tampered).totalsMatchCount).toBe(false);
  });

  it('tolerates missing optional blocks', () => {
    const minimal = `<?xml version="1.0"?><roll_call_vote><congress>119</congress><session>2</session>
      <vote_number>3</vote_number><members><member><lis_member_id>S1</lis_member_id><vote_cast>Present</vote_cast></member></members>
      </roll_call_vote>`;
    const parsed = parseSenateVote(minimal);
    expect(parsed.document).toBeNull();
    expect(parsed.date).toBeNull();
    expect(parsed.totals).toEqual({ yea: 0, nay: 0, present: 1, notVoting: 0 });
  });
});

describe('parseSenateMenu', () => {
  it('lists votes newest first with tallies', () => {
    const menu = parseSenateMenu(fixture('senate/vote_menu_119_2.xml'));
    expect(menu).toMatchObject({ congress: 119, session: 2, year: 2026 });
    expect(menu.votes).toHaveLength(5);
    expect(menu.votes[0]).toMatchObject({
      rollNumber: 256,
      question: 'On the Nomination',
      result: 'Confirmed',
      yeas: 47,
      nays: 41,
    });
  });
});

describe('dates', () => {
  it('applies Eastern daylight and standard time', () => {
    expect(easternOffset(2026, 9, 30)).toBe('-04:00');
    expect(easternOffset(2026, 1, 9)).toBe('-05:00');
    expect(easternOffset(2026, 3, 8)).toBe('-04:00'); // 2nd Sunday of March 2026
    expect(easternOffset(2026, 3, 7)).toBe('-05:00');
    expect(easternOffset(2026, 11, 1)).toBe('-05:00'); // 1st Sunday of November 2026
    expect(easternOffset(2026, 10, 31)).toBe('-04:00');
  });

  it('parses 12 AM and 12 PM correctly', () => {
    expect(parseSenateDate('September 30, 2026,  12:51 PM')).toBe('2026-09-30T12:51:00-04:00');
    expect(parseSenateDate('January 3, 2026, 12:05 AM')).toBe('2026-01-03T00:05:00-05:00');
    expect(parseSenateDate('garbage')).toBeNull();
  });
});

describe('helpers', () => {
  it('maps document types to bill types', () => {
    expect(senateDocTypeToBillType('H.R.')).toBe('hr');
    expect(senateDocTypeToBillType('S.J.Res.')).toBe('sjres');
    expect(senateDocTypeToBillType('S.Con.Res.')).toBe('sconres');
    expect(senateDocTypeToBillType('PN')).toBeNull();
  });

  it('builds senate.gov URLs', () => {
    expect(menuUrl(119, 2)).toBe('https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_2.xml');
    expect(voteUrl(119, 1, 1)).toBe(
      'https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00001.xml',
    );
  });

  it('fetches through SenateClient', async () => {
    const fetch = replayFetch([
      {
        match: (u) => u.pathname.endsWith('vote_119_1_00001.xml'),
        respond: () => new Response(fixture('senate/vote_119_1_00001.xml')),
      },
    ]);
    const vote = await new SenateClient({ fetch }).getVote(119, 1, 1);
    expect(vote.rollNumber).toBe(1);
  });
});
