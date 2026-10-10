import { describe, expect, it } from 'vitest';
import { legislatorFilter } from './feed-filters';

describe('feed legislator filter', () => {
  it('matches followed legislators at one level, and what they do', () => {
    expect(legislatorFilter('state')).toBe(
      'target_type.eq.state_legislator,and(reason.eq.legislator,member_type.eq.state_legislator)',
    );
  });

  it('covers every level when none is chosen', () => {
    const all = legislatorFilter('');
    for (const t of ['member', 'state_legislator', 'local_official']) expect(all).toContain(`target_type.eq.${t}`);
  });
});
