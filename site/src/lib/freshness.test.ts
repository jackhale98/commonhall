import { describe, expect, it } from 'vitest';
import { noteJobs, noteState, noteText, timeAgo, type CoverageRow } from './freshness';
import { coverageLabel, stillLoading, type StatusRow } from './status';

const now = new Date('2026-10-21T16:00:00Z');
const job = (name: string, last_ok: string | null, problem: string | null = null): StatusRow => ({
  kind: 'job',
  name,
  label: name,
  last_ok,
  newest: null,
  problem,
});
const status = [
  job('federal-bills', '2026-10-21T15:48:00Z'),
  job('worcester', '2026-10-21T13:00:00Z'),
  job('load-worcester-agendas', '2026-10-20T09:00:00Z'),
  job('scotus', '2026-10-19T08:00:00Z', 'overdue'),
];
const coverage: CoverageRow[] = [
  { source: 'bills:119', held: 19_696, expected: 19_716, counted_at: '2026-10-21T09:00:00Z' },
  { source: 'state-bills:CT', held: 1_200, expected: 4_100, counted_at: '2026-10-18T09:00:00Z' },
  { source: 'state-bills:RI', held: 10, expected: 2_000, counted_at: '2026-09-01T09:00:00Z' },
];

describe('freshness notes', () => {
  it('say when a source last updated, relatively in the browser and exactly at build time', () => {
    const state = noteState(status, coverage, ['federal-bills'], 'bills:119', now);
    // 19,696 of 19,716 is today's new bills, not a load in progress.
    expect(state).toEqual({ lastOk: '2026-10-21T15:48:00Z', problem: null, loading: null });
    expect(noteText(state, 'Congress.gov', 'bills', now, true).fresh).toBe('Updated from Congress.gov 12 minutes ago.');
    const built = noteText(state, 'Congress.gov', 'bills', now, false);
    expect(built.fresh).toBe('Updated from Congress.gov on Oct 21, 2026, 11:48 AM EDT.');
    expect(built.exact).toBe('Oct 21, 2026, 11:48 AM EDT');
  });

  it('use the oldest of a section’s jobs, and warn when one is behind', () => {
    expect(noteState(status, [], ['worcester', 'load-worcester-agendas'], undefined, now).lastOk).toBe(
      '2026-10-20T09:00:00Z',
    );
    const late = noteText(noteState(status, [], ['scotus'], undefined, now), 'CourtListener', 'records', now, true);
    expect(late).toMatchObject({
      delayed: true,
      fresh: 'Updates from CourtListener are delayed; last updated on Oct 19, 2026.',
    });
    // Inside a source line that already names the source.
    expect(noteText(noteState(status, [], ['worcester'], undefined, now), '', 'records', now, true).fresh).toBe(
      'Last updated 3 hours ago.',
    );
  });

  it('say whole records are still loading only when well short of a recent total', () => {
    const ct = noteState(status, coverage, ['federal-bills'], 'state-bills:CT', now);
    expect(noteText(ct, 'Open States', 'bills in the 2026 session', now, true).loading).toBe(
      'Still loading: 1,200 of 4,100 bills in the 2026 session so far.',
    );
    // A total counted seven weeks ago is too old to go by.
    expect(noteState(status, coverage, ['federal-bills'], 'state-bills:RI', now).loading).toBeNull();
    expect(stillLoading(coverage).map((c) => coverageLabel(c.source))).toEqual([
      'Connecticut: state bills',
      'Rhode Island: state bills',
    ]);
  });

  it('count time the way people say it', () => {
    expect(timeAgo('2026-10-21T15:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-21T15:00:00Z', now)).toBe('an hour ago');
    expect(timeAgo('2026-10-20T12:00:00Z', now)).toBe('yesterday');
    expect(timeAgo('2026-10-12T12:00:00Z', now)).toBe('on Oct 12, 2026');
  });

  it('list every job the notes refer to', () => {
    expect(noteJobs()).toContain('federal-bills');
    expect(noteJobs()).toContain('boston-311');
  });
});
