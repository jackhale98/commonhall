/**
 * SeeClickFix's public API v2 (https://seeclickfix.com/api/v2), where towns such as
 * Middletown, Connecticut take 311-style requests. Public, no key. Issues are read a
 * page of 100 at a time, at most one request a second, and only the fields a daily
 * summary needs are kept: no description, address, reporter or exact location.
 *
 *   GET /api/v2/issues?place_url=middletown&after=…&status=…&per_page=100&page=N
 */
import { HttpClient, type HttpOptions } from './http.ts';
import { checkShape, type Shape } from './shape.ts';
import type { Day311 } from './report-311.ts';

/** What we keep of an issue: when it was opened and closed, and what kind it is. */
export interface SeeClickFixIssue {
  id: number;
  status: string;
  /** The request type's title, as the issue's summary ("Pothole Issues"). */
  summary: string;
  /** With the town's UTC offset: "2026-10-10T08:03:12-04:00". */
  created_at: string;
  closed_at: string | null;
}

interface IssuesPage {
  issues: (SeeClickFixIssue & { request_type?: { title?: string } | null })[];
  metadata?: { pagination?: { next_page?: number | null; pages?: number } };
}

export const SEECLICKFIX_ISSUE_SHAPE = {
  id: 'number',
  status: 'string',
  summary: 'string',
  created_at: 'date',
  closed_at: 'date?',
} satisfies Shape;

/** Every status, so closed and archived issues count too (the API leaves them out by default). */
const STATUSES = 'Open,Acknowledged,Closed,Archived';

export class SeeClickFixClient {
  readonly http: HttpClient;
  readonly baseUrl: string;

  constructor(options: HttpOptions & { baseUrl?: string } = {}) {
    this.http = new HttpClient({ maxAttempts: 4, minIntervalMs: 1000, ...options });
    this.baseUrl = (options.baseUrl ?? 'https://seeclickfix.com/api/v2').replace(/\/$/, '');
  }

  /** Issues in a place created on or after `after` (an ISO time), newest first. */
  async issues(place: string, after: string, maxPages = 50): Promise<SeeClickFixIssue[]> {
    const out: SeeClickFixIssue[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(`${this.baseUrl}/issues`);
      url.searchParams.set('place_url', place);
      url.searchParams.set('after', after);
      url.searchParams.set('status', STATUSES);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const body = await this.http.getJson<IssuesPage>(url.toString());
      const issues = checkShape(`SeeClickFix ${place} issues`, body.issues ?? [], SEECLICKFIX_ISSUE_SHAPE);
      for (const i of issues)
        out.push({
          id: i.id,
          status: i.status,
          summary: (i.request_type?.title ?? i.summary).trim(),
          created_at: i.created_at,
          closed_at: i.closed_at ?? null,
        });
      if (!body.metadata?.pagination?.next_page || issues.length === 0) return out;
    }
    throw new Error(`SeeClickFix ${place}: more than ${maxPages} pages of issues; narrow the window`);
  }
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * Issues as daily counts by request type (the town's own day, from the offset in
 * `created_at`), for report311. SeeClickFix has no deadlines, so nothing counts as
 * on time; the report says so (`onTime: false`). Districts are 0: the city has none.
 */
export function issuesToDays(issues: SeeClickFixIssue[]): Day311[] {
  const groups = new Map<string, { day: string; type: string; opened: number; hours: number[] }>();
  for (const i of issues) {
    const day = i.created_at.slice(0, 10);
    const type = i.summary || 'Other';
    const key = `${day}|${type}`;
    const g = groups.get(key) ?? { day, type, opened: 0, hours: [] };
    g.opened += 1;
    if (i.closed_at) {
      const hours = (Date.parse(i.closed_at) - Date.parse(i.created_at)) / 3_600_000;
      if (Number.isFinite(hours) && hours >= 0) g.hours.push(hours);
    }
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const m = median(g.hours);
    return {
      day: g.day,
      district: 0,
      request_type: g.type,
      source: 'seeclickfix',
      opened: g.opened,
      closed: g.hours.length,
      closed_on_time: 0,
      median_close_hours: m === null ? null : Math.round(m * 100) / 100,
    };
  });
}
