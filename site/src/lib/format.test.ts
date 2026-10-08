import { describe, expect, it } from 'vitest';
import { dedupeActions } from '../components/ActionTimeline';
import {
  billDisplayTitle,
  formatDate,
  initials,
  memberRole,
  memberTag,
  paragraphs,
  partyClass,
  stateName,
} from './format';

describe('format helpers', () => {
  it('formats calendar dates without timezone drift', () => {
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDate(null)).toBe('');
  });

  it('describes members', () => {
    expect(memberRole({ chamber: 'senate', state: 'WA', district: null })).toBe('Senator from Washington');
    expect(memberRole({ chamber: 'house', state: 'TX', district: 19 })).toBe(
      'Representative for Texas’s 19th district',
    );
    expect(memberRole({ chamber: 'house', state: 'WY', district: 0 })).toBe('Representative for Wyoming (at large)');
    expect(memberRole({ chamber: 'house', state: 'DC', district: 0 })).toBe('Delegate for District of Columbia');
    expect(memberRole({ chamber: 'house', state: 'PR', district: 0 })).toBe('Resident Commissioner for Puerto Rico');
    expect(memberRole({ chamber: 'senate', state: 'OH', district: null, current: false })).toBe(
      'Former senator from Ohio',
    );
    expect(memberTag({ party: 'R', state: 'TX', district: 19, chamber: 'house' })).toBe('R-TX-19');
    expect(memberTag({ party: 'D', state: 'WY', district: 0, chamber: 'house' })).toBe('D-WY-AL');
    expect(memberTag({ party: 'I', state: 'VT', district: null, chamber: 'senate' })).toBe('I-VT');
    expect(partyClass('Democratic')).toBe('party-d');
    expect(stateName('ny')).toBe('New York');
    expect(initials('Jodey C. Arrington')).toBe('JA');
  });

  it('prefers the short title', () => {
    expect(billDisplayTitle({ short_title: 'Short Act', title: 'A bill to…' })).toBe('Short Act');
    expect(billDisplayTitle({ short_title: null, title: 'A bill to…' })).toBe('A bill to…');
  });

  it('splits summaries into paragraphs', () => {
    expect(paragraphs('One\n\nTwo\n• a\n• b')).toEqual(['One', 'Two\n• a\n• b']);
    expect(paragraphs(null)).toEqual([]);
  });
});

describe('dedupeActions', () => {
  it('merges the chamber and Library of Congress copies of an action, newest first', () => {
    const actions = [
      { seq: 1, action_date: '2025-01-01', text: 'Introduced in House' },
      { seq: 2, action_date: '2025-05-22', text: 'On passage Passed by recorded vote: 215 - 214' },
      {
        seq: 3,
        action_date: '2025-05-22',
        text: 'Passed/agreed to in House: On passage Passed by recorded vote: 215 - 214',
      },
    ];
    expect(dedupeActions(actions).map((a) => a.seq)).toEqual([3, 1]);
  });
});
