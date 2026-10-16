import { describe, expect, it } from 'vitest';
import { ballotResult, electionLabel } from './ballot';

describe('ballot questions', () => {
  it('names the election', () => {
    expect(electionLabel('2026-11-03')).toBe('November 3, 2026 state election');
    expect(electionLabel('2026-04-14')).toBe('April 14, 2026 election');
  });

  it('gives a result only with both counts', () => {
    expect(ballotResult({ yes_count: null, no_count: null })).toBeNull();
    expect(ballotResult({ yes_count: 620, no_count: 380 })).toMatchObject({ passed: true, label: 'Passed, 62% yes' });
    expect(ballotResult({ yes_count: 400, no_count: 600 })).toMatchObject({ passed: false, label: 'Failed, 40% yes' });
  });
});
