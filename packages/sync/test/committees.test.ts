import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { committeeSystemCode, type BillAction } from '@civic/congress-client';
import {
  billCommitteeRows,
  committeeMeetingRow,
  committeeMemberRows,
  committeeRows,
  meetingPageUrl,
} from '../src/federal/committees.ts';

const fixture = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../congress-client/test/fixtures/${path}`, import.meta.url), 'utf8'));

describe('committees', () => {
  it('maps congress-legislators committees to Congress.gov system codes', () => {
    expect(committeeSystemCode('HSAG')).toBe('hsag00');
    expect(committeeSystemCode('HSAG', '15')).toBe('hsag15');
    const rows = committeeRows(fixture('legislators/committees-current-sample.json'));
    expect(rows.find((r) => r.code === 'hsag00')).toMatchObject({
      chamber: 'house',
      name: 'House Committee on Agriculture',
      parent_code: null,
    });
    expect(rows.find((r) => r.code === 'hsag15')).toMatchObject({
      parent_code: 'hsag00',
      name: 'Forestry and Horticulture',
    });
    expect(rows.find((r) => r.code === 'jsec00')).toMatchObject({ chamber: 'joint' });
  });

  it('reads rosters with leadership titles and sides', () => {
    const rows = committeeMemberRows(fixture('legislators/committee-membership-sample.json'));
    expect(rows.find((r) => r.committee_code === 'ssfi00' && r.rank === 1 && r.side === 'majority')).toMatchObject({
      title: 'Chairman',
    });
    expect(rows.find((r) => r.committee_code === 'ssfi00' && r.member_id === 'W000779')).toMatchObject({
      side: 'minority',
      title: 'Ranking Member',
    });
    expect(rows.some((r) => r.committee_code === 'hsag15')).toBe(true);
  });

  it('finds each committee named in a bill’s actions', () => {
    const actions = fixture('congress/bill-hr1-actions.json').actions as BillAction[];
    const rows = billCommitteeRows('119-hr-1', actions);
    const finance = rows.find((r) => r.committee_code === 'ssfi00');
    expect(finance).toMatchObject({ bill_id: '119-hr-1', committee_name: 'Finance Committee' });
    expect(rows.every((r) => r.referred_date === null || /^\d{4}-\d{2}-\d{2}$/.test(r.referred_date))).toBe(true);
  });

  it('dates the referral and the report', () => {
    const rows = billCommitteeRows('119-hr-9', [
      {
        actionDate: '2025-03-04',
        text: 'Reported by the Committee on Agriculture. H. Rept. 119-10.',
        committees: [{ systemCode: 'hsag00', name: 'Agriculture Committee' }],
      },
      {
        actionDate: '2025-01-10',
        text: 'Referred to the House Committee on Agriculture.',
        committees: [{ systemCode: 'hsag00', name: 'Agriculture Committee' }],
      },
    ] as BillAction[]);
    expect(rows).toEqual([
      expect.objectContaining({
        committee_code: 'hsag00',
        referred_date: '2025-01-10',
        reported_date: '2025-03-04',
        last_action_date: '2025-03-04',
      }),
    ]);
  });

  it('maps a recorded hearing', () => {
    const { committeeMeeting } = fixture('congress/committee-meeting-119557.json');
    const row = committeeMeetingRow(committeeMeeting, 'house');
    expect(row).toMatchObject({
      id: '119-house-119557',
      chamber: 'house',
      meeting_type: 'Hearing',
      status: 'Scheduled',
      date: '2026-09-15T14:00:00.000Z',
      location: '2154, Rayburn House Office Building',
      committee_codes: ['hsgo27'],
      video_url: 'https://www.youtube.com/watch?v=wUF4RW4zUK8',
      url: 'https://www.congress.gov/event/119th-Congress/house-event/119557',
    });
    expect(row!.witnesses[0]).toEqual({
      name: 'Mr. Ted Okon',
      organization: 'Community Oncology Alliance',
      position: 'Executive Director',
    });
    expect(meetingPageUrl(119, 'Senate', '336000')).toBe(
      'https://www.congress.gov/event/119th-Congress/senate-event/336000',
    );
  });
});
