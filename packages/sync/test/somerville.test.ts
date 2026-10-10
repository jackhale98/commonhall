import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyFilter, checkShape, report311, type Day311, type LegistarEvent } from '@civic/congress-client';
import { BOSTON, matterRow, meetingCommittees, officialRow } from '../src/local/boston.ts';
import {
  SOMERVILLE,
  SOMERVILLE_311_SHAPE,
  SOMERVILLE_COMMITTEE_BODIES,
  seatFromTitle,
  somerville311Query,
  somervilleRow311,
} from '../src/local/somerville.ts';

/** Recorded from webapi.legistar.com/v1/somervillema and data.somervillema.gov (2026-10-10), trimmed. */
const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/somerville/${name}`, import.meta.url), 'utf8')) as T;

describe('Somerville council settings', () => {
  it('reads every seat from the office record titles', () => {
    const records = fixture<Parameters<typeof officialRow>[0][]>('officerecords.json');
    const rows = records.map((r) => officialRow(r, { seats: [] }, SOMERVILLE));
    expect(rows).toHaveLength(11);
    expect(rows.filter((r) => r.seat === 'At-Large' && r.district === null)).toHaveLength(4);
    expect(rows.filter((r) => r.district).map((r) => r.district)).toEqual(
      expect.arrayContaining([1, 2, 3, 4, 5, 6, 7]),
    );
    expect(rows.find((r) => r.title === 'Ward Three City Councilor')).toMatchObject({ seat: 'Ward 3', district: 3 });
    expect(rows.every((r) => r.id.startsWith('ma-somerville-p'))).toBe(true);
  });

  it('parses seat titles in words or digits, and nothing else', () => {
    expect(seatFromTitle('Ward Seven City Councilor')).toEqual({ seat: 'Ward 7', district: 7 });
    expect(seatFromTitle('Ward 2 Councillor')).toEqual({ seat: 'Ward 2', district: 2 });
    expect(seatFromTitle('City Councilor At Large')).toEqual({ seat: 'At-Large', district: null });
    expect(seatFromTitle('Councillor-at-Large')).toEqual({ seat: 'At-Large', district: null });
    expect(seatFromTitle('District Four Councilor', 'District')).toEqual({ seat: 'District 4', district: 4 });
    expect(seatFromTitle('President')).toBeNull();
    expect(seatFromTitle(null)).toBeNull();
  });

  it('a seat map entry wins over the title; Boston reads no titles', () => {
    const r = fixture<Parameters<typeof officialRow>[0][]>('officerecords.json')[0]!;
    const map = { seats: [{ personId: r.OfficeRecordPersonId, name: 'x', seat: 'Ward 9', district: 9 }] };
    expect(officialRow(r, map, SOMERVILLE)).toMatchObject({ seat: 'Ward 9', district: 9 });
    expect(
      officialRow({ ...r, OfficeRecordTitle: 'Ward Three City Councilor' }, { seats: [] }, BOSTON).seat,
    ).toBeNull();
  });

  it('files committee meetings under their body, and council meetings under none', () => {
    const events = fixture<LegistarEvent[]>('events.json');
    expect(events.map((e) => meetingCommittees(e, SOMERVILLE))).toEqual([[], ['Finance']]);
    expect(
      meetingCommittees({ EventBodyName: 'Rodent Issues Special Committee ', EventLocation: null }, SOMERVILLE),
    ).toEqual([]);
    // Boston still reads its location text.
    expect(
      meetingCommittees({ EventBodyName: 'City Council', EventLocation: 'Ways & Means Committee Hearing' }, BOSTON),
    ).toEqual(['Ways and Means']);
  });

  it('lists committees that are active Legistar bodies', () => {
    const bodies = fixture<{ BodyName: string; BodyTypeName: string; BodyActiveFlag: number }[]>('bodies.json');
    const active = new Set(bodies.filter((b) => b.BodyActiveFlag === 1).map((b) => b.BodyName.trim()));
    for (const body of Object.keys(SOMERVILLE_COMMITTEE_BODIES)) expect(active).toContain(body);
    expect(SOMERVILLE.committees).toContain('Legislative Matters');
    expect(SOMERVILLE.committees).not.toContain('Finance Committee');
  });

  it('keys matters and links to Somerville’s Legistar', () => {
    const row = matterRow(
      {
        MatterId: 35133,
        MatterFile: '26-1488',
        MatterTitle: 'Requesting an appropriation',
        MatterTypeName: "Mayor's Request",
      } as never,
      undefined,
      SOMERVILLE,
    );
    expect(row).toMatchObject({ id: 'ma-somerville-35133', city: 'ma-somerville' });
    expect(row.legistar_url).toBe('https://somervillema.legistar.com/gateway.aspx?M=L&ID=35133');
    expect(SOMERVILLE.docketLabel('26-1488')).toBe('File #26-1488');
    expect(SOMERVILLE.legislativeTypes.has("Mayor's Request")).toBe(true);
    expect(SOMERVILLE.legislativeTypes.has('License')).toBe(false);
  });

  it('asks Legistar for several bodies at once', () => {
    expect(bodyFilter(138)).toBe('EventBodyId eq 138');
    expect(bodyFilter([138, 181])).toBe('(EventBodyId eq 138 or EventBodyId eq 181)');
  });
});

describe('Somerville 311', () => {
  const recorded = fixture<Record<string, unknown>[]>('soql-311.json');

  it('the recorded portal response has the fields the sync reads', () => {
    expect(() => checkShape('311', recorded, SOMERVILLE_311_SHAPE)).not.toThrow();
    expect(() =>
      checkShape(
        '311',
        recorded.map(({ type: _, ...r }) => ({ ...r, request_type: 'x' })),
        SOMERVILLE_311_SHAPE,
      ),
    ).toThrow(/"type"/);
  });

  it('maps summary rows: wards 1–7, others 0, no median when nothing closed', () => {
    const rows = recorded.map(somervilleRow311);
    expect(rows.every((r) => r !== null)).toBe(true);
    expect(rows[0]).toEqual({
      day: '2026-10-01',
      district: 1,
      request_type: 'Abandoned Property or Illegal Dumping',
      source: 'somerville',
      opened: 1,
      closed: 1,
      closed_on_time: 0,
      median_close_hours: 23.35,
    });
    const noWard = recorded.findIndex((r) => !('ward' in r));
    expect(rows[noWard]!.district).toBe(0);
    const open = recorded.findIndex((r) => r.closed === '0');
    expect(rows[open]!.median_close_hours).toBeNull();
    expect(somervilleRow311({ day: '2026-10-01', ward: '9', type: 'X', opened: '1', closed: '0' })!.district).toBe(0);
    expect(somervilleRow311({ day: '2026-10-01', ward: '3', type: ' ', opened: '1' })).toBeNull();
  });

  it('builds a report for seven wards that says there are no target times', () => {
    const rows = recorded.map(somervilleRow311).filter((r): r is Day311 => r !== null);
    const report = report311(rows, { districts: 7, onTime: false })!;
    expect(report.onTime).toBe(false);
    expect(Object.keys(report.districts)).toHaveLength(7);
    expect(report.city.opened).toBe(rows.reduce((n, r) => n + r.opened, 0));
    expect(report311(rows, { districts: 7 })!.onTime).toBeUndefined();
  });

  it('queries service requests only, by text date, grouped by day, ward and type', () => {
    const q = somerville311Query('2026-08-09', '2026-10-09');
    expect(q.$where).toBe(
      "classification = 'Service' AND date_created >= '2026-08-09' AND date_created < '2026-10-10'",
    );
    expect(q.$group).toBe('day, ward, type');
    expect(q.$select).toMatch(/count\(\*\) AS opened/);
    expect(q.$select).toMatch(/median\(case\(most_recent_status = 'Closed'/);
  });
});
