import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CivicClerkClient, type CivicClerkEvent, type CivicClerkMeeting } from '@civic/congress-client';
import { bristolAgendaItems, bristolItemType, bristolMatterNumber, bristolMeetingRow } from '../src/local/bristol.ts';

const fixture = <T>(name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../congress-client/test/fixtures/civicclerk/${name}`, import.meta.url), 'utf8'),
  ) as T;

describe('Bristol agenda items', () => {
  const items = bristolAgendaItems(fixture<CivicClerkMeeting>('meeting-2916.json').items);

  it('keeps numbered business and leaves out procedure', () => {
    expect(items.map((i) => i.number)).not.toContain('2026-2402'); // a proclamation under Call to Order
    expect(items.map((i) => i.number)).not.toContain('2026-2403'); // approval of minutes
    expect(items[0]).toMatchObject({
      number: '2026-2404',
      matterNumber: 202602404,
      outline: '5a',
      section: 'Consent Agenda',
      type: 'Consent agenda',
    });
    expect(items).toHaveLength(19);
  });

  it('types items from their wording, then their section', () => {
    const flood = items.find((i) => i.number === '2026-2511')!;
    expect(flood.text).toMatch(/^Ordinance Committee - To adopt amendments to Appendix D/);
    expect(flood.type).toBe('Ordinance');
    expect(items.find((i) => i.number === '2026-2513')!.type).toBe('Contract');
    expect(items.find((i) => i.number === '2026-2406')!.type).toBe('Appointment');
    expect(items.find((i) => i.number === '2026-2515')!.type).toBe('Executive session');
    expect(bristolItemType('Discussion of the Homestead Act', 'New Business')).toBe('Business');
  });

  it('numbers matters by year and item', () => {
    expect(bristolMatterNumber('2026-2402')).toBe(202602402);
    expect(bristolMatterNumber('')).toBeNull();
    expect(bristolMatterNumber('A-12')).toBeNull();
  });
});

describe('Bristol meetings', () => {
  const events = [
    ...fixture<{ value: CivicClerkEvent[] }>('events-1.json').value,
    ...fixture<{ value: CivicClerkEvent[] }>('events-2.json').value,
  ];
  const civicclerk = new CivicClerkClient();

  it('reads the local time, files and portal link', () => {
    const row = bristolMeetingRow(
      events.find((e) => e.id === 4765)!,
      civicclerk,
      null,
    );
    expect(row).toMatchObject({
      id: 'ct-bristol-m4765',
      date: '2026-09-08',
      time: '7:00 PM',
      starts_at: '2026-09-08T23:00:00.000Z',
      location: 'Council Chambers, 111 N Main Street',
      legistar_url: 'https://bristolct.portal.civicclerk.com/event/4765/overview',
      committees: [],
      status: null,
    });
    expect(row.agenda_url).toMatch(/GetMeetingFileStream\(fileId=13374,/);
    expect(row.minutes_url).toMatch(/fileId=13466,/);
  });

  it('files a committee’s meetings under the committee', () => {
    const e = events.find((x) => x.categoryName === 'Ordinance Committee')!;
    expect(bristolMeetingRow(e, civicclerk, 'Ordinance Committee').committees).toEqual(['Ordinance Committee']);
  });
});
