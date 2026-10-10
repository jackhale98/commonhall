import { describe, expect, it } from 'vitest';
import { report311 } from '../src/report-311.ts';
import { SeeClickFixClient, issuesToDays, type SeeClickFixIssue } from '../src/seeclickfix.ts';
import { ShapeError } from '../src/shape.ts';
import { fixture, json, noSleep, replayFetch } from './helpers.ts';

describe('SeeClickFixClient', () => {
  it('reads every status, a hundred at a time, keeping only what a summary needs', async () => {
    const fetch = replayFetch([
      { match: () => true, respond: () => json(JSON.parse(fixture('seeclickfix/issues.json'))) },
    ]);
    const issues = await new SeeClickFixClient({ fetch, sleep: noSleep }).issues(
      'middletown',
      '2026-08-09T00:00:00-05:00',
    );
    expect(issues).toHaveLength(30);
    const url = fetch.calls[0]!;
    expect(url.searchParams.get('place_url')).toBe('middletown');
    expect(url.searchParams.get('status')).toBe('Open,Acknowledged,Closed,Archived');
    expect(url.searchParams.get('per_page')).toBe('100');
    expect(Object.keys(issues[0]!).sort()).toEqual(['closed_at', 'created_at', 'id', 'status', 'summary']);
  });

  it('follows next_page', async () => {
    const page = JSON.parse(fixture('seeclickfix/issues.json')) as {
      issues: unknown[];
      metadata: { pagination: { next_page: number | null } };
    };
    const fetch = replayFetch([
      {
        match: () => true,
        respond: (u) =>
          json(
            u.searchParams.get('page') === '1'
              ? { ...page, metadata: { pagination: { next_page: 2 } } }
              : { ...page, issues: page.issues.slice(0, 5) },
          ),
      },
    ]);
    const issues = await new SeeClickFixClient({ fetch, sleep: noSleep }).issues('middletown', '2026-08-09');
    expect(issues).toHaveLength(35);
    expect(fetch.calls).toHaveLength(2);
  });

  it('fails on a renamed field', async () => {
    const body = JSON.parse(fixture('seeclickfix/issues.json')) as { issues: Record<string, unknown>[] };
    for (const i of body.issues) {
      i.opened_at = i.created_at;
      delete i.created_at;
    }
    const fetch = replayFetch([{ match: () => true, respond: () => json(body) }]);
    await expect(new SeeClickFixClient({ fetch, sleep: noSleep }).issues('middletown', '2026-08-09')).rejects.toThrow(
      ShapeError,
    );
  });
});

describe('issuesToDays', () => {
  const issue = (day: string, summary: string, closedHours: number | null): SeeClickFixIssue => ({
    id: Math.random(),
    status: closedHours === null ? 'Open' : 'Closed',
    summary,
    created_at: `${day}T10:00:00-04:00`,
    closed_at:
      closedHours === null
        ? null
        : new Date(Date.parse(`${day}T10:00:00-04:00`) + closedHours * 3_600_000).toISOString(),
  });

  it('counts by the town’s day and type, with a median time to close', () => {
    const days = issuesToDays([
      issue('2026-10-01', 'Pothole Issues', 2),
      issue('2026-10-01', 'Pothole Issues', 10),
      issue('2026-10-01', 'Pothole Issues', null),
      issue('2026-10-02', 'Street Lamp', 48),
    ]);
    expect(days).toContainEqual({
      day: '2026-10-01',
      district: 0,
      request_type: 'Pothole Issues',
      source: 'seeclickfix',
      opened: 3,
      closed: 2,
      closed_on_time: 0,
      median_close_hours: 6,
    });
    expect(days).toHaveLength(2);
  });

  it('makes a report that claims nothing about deadlines', () => {
    const report = report311(issuesToDays([issue('2026-10-01', 'Pothole Issues', 2)]), {
      districts: 0,
      onTime: false,
    });
    expect(report?.onTime).toBe(false);
    expect(report?.districts).toEqual({});
    expect(report?.city.opened).toBe(1);
  });

  it('works on the recorded issues', () => {
    const issues = (
      JSON.parse(fixture('seeclickfix/issues.json')) as { issues: (SeeClickFixIssue & { request_type: unknown })[] }
    ).issues;
    const days = issuesToDays(issues);
    expect(days.reduce((n, d) => n + d.opened, 0)).toBe(30);
    expect(days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))).toBe(true);
  });
});
