import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Iqm2Client,
  PrimeGovClient,
  parseCambridgeActions,
  parseLegiFile,
  report311,
  type Iqm2MeetingListing,
  type PrimeGovMeeting,
} from '@civic/congress-client';
import {
  PRIMEGOV_EVENT_OFFSET,
  cambridgeOfficialRow,
  cambridgeVoteId,
  iqm2Actions,
  iqm2MeetingRow,
  passedFlag,
  primeGovActions,
  primeGovMeetingRow,
  tidyResult,
} from '../src/local/cambridge.ts';
import { cambridge311Days, cambridgeBudgetRow, cambridgeCapitalProjects } from '../src/local/cambridge-data.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`../../congress-client/test/fixtures/cambridge/${name}`, import.meta.url), 'utf8');

describe('Cambridge council rows', () => {
  it('keeps every councillor at-large, with the mayor’s title', () => {
    expect(
      cambridgeOfficialRow({ UserID: 1368, FullName: 'Sumbul Siddiqui', Title: 'Mayor', RollCallSort: 9 }),
    ).toMatchObject({
      id: 'ma-cambridge-sumbul-siddiqui',
      person_id: 1368,
      seat: 'At-Large',
      district: null,
      title: 'Mayor',
      current: true,
    });
    expect(
      cambridgeOfficialRow({ UserID: 1, FullName: 'Marc C. McGovern', Title: 'Councillor', RollCallSort: 4 }).title,
    ).toBeNull();
  });

  it('turns an IQM2 listing into meetings, cancelled ones marked', () => {
    const iqm2 = new Iqm2Client();
    const [cancelled, held] = JSON.parse(fixture('iqm2-meetings.json')) as Iqm2MeetingListing[];
    expect(iqm2MeetingRow(cancelled!.Meeting, iqm2, null, null)).toMatchObject({
      id: 'ma-cambridge-m4769',
      status: 'Cancelled',
      committees: [],
    });
    expect(iqm2MeetingRow(held!.Meeting, iqm2, null, null)).toMatchObject({
      date: '2025-12-22',
      time: '5:30 PM',
      starts_at: '2025-12-22T22:30:00.000Z',
      location: 'Sullivan Chamber',
      status: null,
    });
  });

  it('keeps council and committee meetings from PrimeGov, not boards', () => {
    const primegov = new PrimeGovClient({ client: 'cambridgema' });
    const meeting = (committeeId: number, title: string): PrimeGovMeeting => ({
      id: 2451,
      committeeId,
      title,
      dateTime: '2026-10-05T17:30:00',
      date: 'Oct 05, 2026',
      time: '05:30 PM',
      location: null,
      videoUrl: null,
      documentList: [{ id: 1, templateId: 11918, templateName: 'HTML Agenda', compileOutputType: 3 }],
    });
    expect(primeGovMeetingRow(meeting(1, 'Regular City Council Meeting'), primegov)).toMatchObject({
      id: 'ma-cambridge-pg2451',
      event_id: PRIMEGOV_EVENT_OFFSET + 2451,
      committees: [],
      agenda_url: 'https://cambridgema.primegov.com/Portal/Meeting?meetingTemplateId=11918',
      starts_at: '2026-10-05T21:30:00.000Z',
    });
    expect(primeGovMeetingRow(meeting(2, 'The Ordinance Committee'), primegov)?.committees).toEqual([
      'Ordinance Committee',
    ]);
    expect(primeGovMeetingRow(meeting(51, 'Water Board'), primegov)).toBeNull();
  });
});

describe('Cambridge actions', () => {
  it('turns IQM2 history into actions, with roll calls where names are given', () => {
    const file = parseLegiFile(fixture('iqm2-legifile-31555.html'), 31555);
    const actions = iqm2Actions(file.history);
    expect(actions.map((a) => [a.date, a.name, a.passed])).toEqual([
      ['2025-12-15', 'Charter Right', null],
      ['2025-12-22', 'Failed of Adoption', 'Fail'],
    ]);
    expect(actions[0]!.vote).toBeNull();
    expect(actions[1]!.vote).toMatchObject({ yes: 4, no: 5 });
    expect(actions[1]!.eventId).toBe(4768);
  });

  it('turns PrimeGov final actions into one action per item', () => {
    const record = parseCambridgeActions(fixture('primegov-final-actions.html'));
    const actions = primeGovActions(record, 2451, '2026-10-05');
    const por = actions.find((a) => a.item.citation.number === 185)!.action;
    expect(por).toMatchObject({ date: '2026-10-05', eventId: PRIMEGOV_EVENT_OFFSET + 2451, passed: null });
    expect(por.vote?.yeas).toHaveLength(9);
  });

  it('words results plainly', () => {
    expect(tidyResult('ORDER ADOPTED')).toBe('Order Adopted');
    expect(tidyResult('REFERRED TO THE ORDINANCE COMMITTEE')).toBe('Referred to the Ordinance Committee');
    expect(tidyResult('Referred to Ordinance Committee as amended')).toBe('Referred to Ordinance Committee as amended');
    expect(passedFlag('Order Adopted and CMA Placed on File')).toBe('Pass');
    expect(passedFlag('FAILED OF ADOPTION')).toBe('Fail');
    expect(passedFlag('Placed on File')).toBeNull();
    expect(cambridgeVoteId(220260185, '2026-10-05')).toBe('ma-cambridge-ei22026018520261005');
  });
});

describe('Cambridge open data', () => {
  it('counts 311 requests per day and category, with typical close times', () => {
    const days = cambridge311Days([
      {
        ticket_created_date_time: '2026-10-01T08:00:00.000',
        ticket_closed_date_time: '2026-10-01T10:00:00.000',
        issue_category: 'Pothole',
        ticket_status: 'Closed',
      },
      {
        ticket_created_date_time: '2026-10-01T09:00:00.000',
        ticket_closed_date_time: '2026-10-01T15:00:00.000',
        issue_category: 'Pothole',
        ticket_status: 'Archived',
      },
      { ticket_created_date_time: '2026-10-01T12:00:00.000', issue_category: 'Pothole', ticket_status: 'Open' },
      { ticket_created_date_time: '2026-10-02T12:00:00.000', issue_category: 'Graffiti', ticket_status: 'Archived' },
    ]);
    expect(days.find((d) => d.request_type === 'Pothole')).toMatchObject({
      day: '2026-10-01',
      district: 0,
      opened: 3,
      closed: 2,
      closed_on_time: 0,
      median_close_hours: 4,
    });
    expect(days.find((d) => d.request_type === 'Graffiti')).toMatchObject({ closed: 1, median_close_hours: null });
    const report = report311(days, { districts: 0, onTime: false })!;
    expect(report).toMatchObject({ to: '2026-10-02', onTime: false, districts: {} });
    expect(report.city.opened).toBe(4);
  });

  it('maps budget summaries to lines', () => {
    expect(
      cambridgeBudgetRow('expense', {
        fiscal_year: '2027',
        service: 'Public Safety',
        department_name: 'Police Department',
        division_name: 'Police -Support Services',
        category: 'Other Ordinary Maintenance',
        amount: '793635.00',
      }),
    ).toEqual({
      city: 'ma-cambridge',
      kind: 'expense',
      cabinet: 'Public Safety',
      dept: 'Police Department',
      grouping: 'Police -Support Services',
      line: 'Other Ordinary Maintenance',
      fiscal_year: 2027,
      basis: 'budget',
      amount: 793635,
    });
    expect(
      cambridgeBudgetRow('revenue', {
        fiscal_year: 2027,
        service: 'Public Safety',
        department_name: 'Police Department',
        category: 'Taxes',
        description: 'Taxes',
        amount: '55514989',
      }),
    ).toMatchObject({ grouping: 'Taxes', line: 'Taxes' });
    expect(cambridgeBudgetRow('expense', { fiscal_year: 'x', amount: '1' })).toBeNull();
  });

  it('folds the five-year capital plan into one row per project', () => {
    const row = (fiscal_year: number, approved_amount: string, fund = 'Public Ways Fund', project_id = '000832') => ({
      fiscal_year,
      department: 'Transportation',
      project_id,
      project_name: 'Transportation: Grand Junction Multi-Use Path',
      fund,
      approved_amount,
    });
    const projects = cambridgeCapitalProjects([
      { fiscal_year: 2026, department: 'Transportation', project_name: 'No id', fund: 'x', approved_amount: '5' },
      row(2027, '1000000'),
      row(2027, '250000', 'Equipment Fund'),
      row(2028, '500000'),
      row(2031, '0'),
      row(2029, '0', 'Public Ways Fund', '000999'),
    ]);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      proj_id: '000832',
      city: 'ma-cambridge',
      plan: 'FY27-31',
      first_year: 2027,
      year1: 1_250_000,
      years_2_5: 500_000,
      total_budget: 1_750_000,
      spent: 0,
    });
  });
});
