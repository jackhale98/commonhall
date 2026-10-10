import { describe, expect, it } from 'vitest';
import type { OSBill } from '@civic/congress-client';
import { FIRST_CLASS_STATES, billRound, isFloorVote, stateVoteRows } from '../src/state/sync-state.ts';

describe('state bill rounds', () => {
  it('lists Massachusetts and Connecticut as first-class', () => {
    expect(FIRST_CLASS_STATES).toEqual(['MA', 'CT']);
  });

  it('alternates one first-class state with each other state', () => {
    expect(billRound(['MA'], ['TX', 'CA'])).toEqual(['MA', 'TX', 'MA', 'CA']);
  });

  it('shares the first-class half between first-class states', () => {
    const round = billRound(['MA', 'CT'], ['TX', 'CA', 'NY', 'VT']);
    expect(round).toEqual(['MA', 'TX', 'CT', 'CA', 'MA', 'NY', 'CT', 'VT']);
    expect(round.filter((s) => s === 'MA' || s === 'CT')).toHaveLength(round.length / 2);
  });

  it('gives every first-class state a turn when few other states are left', () => {
    expect(billRound(['MA', 'CT'], ['TX'])).toEqual(['MA', 'TX', 'CT', 'TX']);
    expect(billRound(['MA', 'CT'], [])).toEqual(['MA', 'CT']);
    expect(billRound([], ['TX', 'CA'])).toEqual(['TX', 'CA']);
  });
});

describe('first-class roll calls', () => {
  const vote = (id: string, classification?: string) => ({
    id,
    motion_text: 'Passage',
    start_date: '2026-05-01',
    result: 'pass',
    ...(classification ? { organization: { classification } } : {}),
    counts: [{ option: 'yes', value: 1 }],
    votes: [{ option: 'yes', voter_name: 'A', voter: { id: 'ocd-person/a', name: 'A' } }],
  });

  it('keeps chamber votes and leaves out committee votes', () => {
    expect(isFloorVote({ organization: { classification: 'lower' } })).toBe(true);
    expect(isFloorVote({ organization: { classification: 'committee' } })).toBe(false);
    expect(isFloorVote({})).toBe(true);
    const bill = {
      id: 'ocd-bill/ct-1',
      votes: [vote('ocd-vote/1', 'lower'), vote('ocd-vote/2', 'committee'), vote('ocd-vote/3', 'upper'), vote('x')],
    } as unknown as OSBill;
    expect(stateVoteRows(bill, 'CT').map((v) => [v.vote.id, v.vote.chamber])).toEqual([
      ['ocd-vote/1', 'lower'],
      ['ocd-vote/3', 'upper'],
    ]);
  });
});
