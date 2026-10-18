import { describe, expect, it } from 'vitest';
import { billRecord, groupVotes, lastName, type RepVoteRow } from './rep-votes';

const row = (vote_id: string, member_id: string, extra: Partial<RepVoteRow> = {}): RepVoteRow => ({
  member_id,
  vote_id,
  position: 'nay',
  chamber: 'senate',
  date: '2026-10-01',
  question: 'On the Nomination',
  title: null,
  result: 'Nomination Confirmed',
  bill_id: null,
  bill_title: null,
  yea_total: 47,
  nay_total: 41,
  ...extra,
});

describe('lastName', () => {
  it('takes the surname, leaving out suffixes', () => {
    expect(lastName('Edward J. Markey')).toBe('Markey');
    expect(lastName('Thomas R. Suozzi Jr.')).toBe('Suozzi');
    expect(lastName('Chuck Grassley, III')).toBe('Grassley');
    expect(lastName('Cher')).toBe('Cher');
  });
});

describe('groupVotes', () => {
  const names = new Map([
    ['W000817', 'Warren'],
    ['M000133', 'Markey'],
    ['L000562', 'Lynch'],
  ]);

  it('groups each roll call with every member’s position, names in order', () => {
    const groups = groupVotes(
      [row('senate-256', 'W000817'), row('senate-256', 'M000133', { position: 'yea' }), row('house-139', 'L000562')],
      names,
    );
    expect(groups.map((g) => g.row.vote_id)).toEqual(['senate-256', 'house-139']);
    expect(groups[0]!.positions).toEqual([
      { name: 'Markey', position: 'yea' },
      { name: 'Warren', position: 'nay' },
    ]);
  });

  it('keeps only the newest vote on each bill or nomination', () => {
    const bill = { bill_id: '119-hr-9340', question: 'On Cloture' };
    const groups = groupVotes(
      [
        row('senate-256', 'W000817', bill),
        row('senate-255', 'W000817', bill),
        row('senate-254', 'W000817', { title: 'Keith Sonderling, of Florida, to be Secretary of Labor' }),
        row('senate-253', 'W000817', { title: 'Keith Sonderling, of Florida, to be Secretary of Labor' }),
      ],
      names,
    );
    expect(groups.map((g) => g.row.vote_id)).toEqual(['senate-256', 'senate-254']);
  });

  it('stops at the limit', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id, 'W000817', { bill_id: `119-hr-${id.charCodeAt(0)}` }));
    expect(groupVotes(rows, names, 3)).toHaveLength(3);
  });
});

describe('billRecord', () => {
  const lynch = { bioguide_id: 'L000562', chamber: 'house' as const };
  const warren = { bioguide_id: 'W000817', chamber: 'senate' as const };
  const votes = [
    { id: 'house-139', chamber: 'house' as const, question: 'On Passage', date: '2026-04-27' },
    { id: 'house-120', chamber: 'house' as const, question: 'On the Rule', date: '2026-04-20' },
  ];

  it('names sponsorship and each vote in the member’s chamber, oldest first', () => {
    const facts = billRecord(lynch, { sponsorId: null, cosponsorIds: ['L000562'], votes }, [
      { vote_id: 'house-139', member_id: 'L000562', position: 'yea' },
      { vote_id: 'house-120', member_id: 'L000562', position: 'not_voting' },
    ]);
    expect(facts).toEqual(['Cosponsor', 'Didn’t vote on “On the Rule”', 'Yes on “On Passage”']);
  });

  it('says when the member’s chamber held no roll call', () => {
    expect(billRecord(warren, { sponsorId: null, cosponsorIds: [], votes }, [])).toEqual(['No Senate roll call on it']);
    expect(billRecord(warren, { sponsorId: 'W000817', cosponsorIds: [], votes: [] }, [])).toEqual([
      'Sponsored it',
      'No Senate roll call on it',
    ]);
  });
});
