import { describe, expect, it } from 'vitest';
import { groupVotes, lastName, type RepVoteRow } from './rep-votes';

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
