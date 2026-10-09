import { describe, expect, it } from 'vitest';
import type { MemberFinance } from './finance';
import { donorName, employerBoard, pacBoard, unityBoard, type UnityRow } from './insights';
import type { Member } from './types';

const member = (id: string, party: string, chamber: 'house' | 'senate' = 'house', current = true) =>
  [id, { bioguide_id: id, name: `Member ${id}`, party, state: 'MA', district: 1, chamber, current } as Member] as const;
const members = new Map([
  member('D1', 'D'),
  member('D2', 'D'),
  member('D3', 'D'),
  member('R1', 'R'),
  member('R2', 'R'),
  member('X', 'D', 'house', false),
  member('S1', 'D', 'senate'),
]);
const row = (
  member_id: string,
  party: 'D' | 'R',
  with_party: number,
  party_votes: number,
  chamber: 'house' | 'senate' = 'house',
): UnityRow => ({
  member_id,
  congress: 119,
  chamber,
  party,
  party_votes,
  with_party,
});

describe('unityBoard', () => {
  const rows = [
    row('D1', 'D', 98, 100),
    row('D2', 'D', 70, 100),
    row('D3', 'D', 9, 10), // too few votes to rank
    row('X', 'D', 50, 100), // no longer serving
    row('R1', 'R', 99, 100),
    row('R2', 'R', 80, 100),
    row('S1', 'D', 20, 20, 'senate'),
  ];

  it('ranks current members with enough party-line votes, most and least often with their party', () => {
    const b = unityBoard(rows, members, 'house', 'D');
    expect(b.most.map((e) => e.id)).toEqual(['D1', 'D2']);
    expect(b.least.map((e) => e.id)).toEqual(['D2', 'D1']);
    expect(b.ranked).toBe(2);
    expect(b.partyLineVotes).toBe(100);
    expect(b.least[0]).toMatchObject({ share: 0.7, with: 70, of: 100 });
  });

  it('keeps chambers and parties apart', () => {
    expect(unityBoard(rows, members, 'house', 'R').most.map((e) => e.id)).toEqual(['R1', 'R2']);
    expect(unityBoard(rows, members, 'senate', 'D').most.map((e) => e.id)).toEqual(['S1']);
  });
});

describe('donor boards', () => {
  const fin = (member_id: string, committees: [string, string, number][], employers: [string, number][] = []) =>
    ({
      member_id,
      top_committees: committees.map(([id, name, total]) => ({ id, name, total, type: 'PAC' })),
      top_employers: employers.map(([name, total]) => ({ name, total, count: 1 })),
    }) as unknown as MemberFinance;
  const finance = [
    fin(
      'D1',
      [
        ['C1', 'ACME PAC', 5000],
        ['C2', 'BETA PAC', 1000],
      ],
      [
        ['ACME CORP', 4000],
        ['RETIRED', 9000],
      ],
    ),
    fin('R1', [['C1', 'ACME PAC', 10000]], [['Acme Corp', 1000]]),
    fin('D2', [['C2', 'BETA PAC', 2000]]),
  ];

  it('adds each PAC up across members, split by the recipients’ party', () => {
    const [acme, beta] = pacBoard(finance, members);
    expect(acme).toMatchObject({ key: 'C1', total: 15000, members: 2, byParty: { D: 5000, R: 10000, other: 0 } });
    expect(beta).toMatchObject({ key: 'C2', total: 3000, members: 2, byParty: { D: 3000, R: 0, other: 0 } });
  });

  it('groups employers by name and leaves out "Retired" and the like', () => {
    const board = employerBoard(finance, members);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ key: 'ACME CORP', total: 5000, members: 2 });
  });

  it('writes all-caps names in title case, keeping acronyms', () => {
    expect(donorName('THE FARM CREDIT COUNCIL PAC')).toBe('The Farm Credit Council PAC');
    expect(donorName('AIPAC')).toBe('AIPAC');
    expect(donorName('Mixed Case Name')).toBe('Mixed Case Name');
  });
});
