import { describe, expect, it } from 'vitest';
import { councilorId, parseBristolCouncil, parseMiddletownCouncil } from '../src/connecticut-cities.ts';
import {
  classifyMiddletownItem,
  longDate,
  parseAgendaCenterList,
  parseMiddletownAgenda,
  sectionName,
} from '../src/middletown-agenda.ts';
import { fixture } from './helpers.ts';

describe('Bristol council page', () => {
  const members = parseBristolCouncil(fixture('connecticut/bristol-council.html'));

  it('reads the mayor and two councilors for each of three districts', () => {
    expect(members).toHaveLength(7);
    expect(members[0]).toMatchObject({
      id: 'ct-bristol-ellen-zoppo-sassu',
      name: 'Ellen Zoppo-Sassu',
      title: 'Mayor',
      seat: 'At-Large',
      district: null,
    });
    expect(members.filter((m) => m.district === 2).map((m) => m.name)).toEqual(['Peter Kelley', 'Susan Tyler']);
  });

  it('takes the email that is shown, not a former member’s empty link', () => {
    expect(members.find((m) => m.name === 'Greg Hahn')).toMatchObject({
      party: 'D',
      seat: 'District 1',
      email: 'greghahn@bristolct.gov',
      photo_url: 'https://www.bristolct.gov/ImageRepository/Document?documentId=50328',
    });
  });

  it('reads nothing from a redesigned page', () => {
    expect(parseBristolCouncil('<main>New site</main>')).toEqual([]);
  });
});

describe('Middletown council page', () => {
  const members = parseMiddletownCouncil(fixture('connecticut/middletown-council.html'));

  it('reads twelve members, without the clerk or the council’s own card', () => {
    expect(members).toHaveLength(12);
    expect(members.every((m) => m.seat === 'At-Large' && m.district === null)).toBe(true);
    expect(members.some((m) => /clerk|council/i.test(m.name))).toBe(false);
  });

  it('keeps leadership titles and drops suffixes from ids', () => {
    expect(members[0]).toMatchObject({ id: 'ct-middletown-jeanette-blackwell', title: 'President', party: 'D' });
    expect(members.find((m) => m.name.startsWith('Anthony Gennaro'))?.id).toBe('ct-middletown-anthony-gennaro');
    expect(members.filter((m) => m.title === null).length).toBe(6);
  });

  it('makes ids from first and last names', () => {
    expect(councilorId('ct-middletown', 'Grady L. Faulkner Jr.')).toBe('ct-middletown-grady-faulkner');
    expect(councilorId('ct-bristol', 'Ellen Zoppo-Sassu')).toBe('ct-bristol-ellen-zoppo-sassu');
  });
});

describe('Middletown Agenda Center listing', () => {
  const postings = parseAgendaCenterList(fixture('connecticut/middletown-agenda-list.html'));

  it('reads each posting once, with its date, title, agenda and minutes', () => {
    expect(postings).toHaveLength(6);
    expect(postings[1]).toEqual({
      id: 11755,
      date: '2026-10-05',
      title: 'Common Council - Regular Meeting',
      agendaUrl: 'https://www.middletownct.gov/AgendaCenter/ViewFile/Agenda/_10052026-11755',
      minutesUrl: null,
    });
    expect(postings.find((p) => p.id === 11745)?.minutesUrl).toBe(
      'https://www.middletownct.gov/AgendaCenter/ViewFile/Minutes/_10052026-11745',
    );
  });

  it('reads dates', () => {
    expect(longDate('Agenda for October 5, 2026')).toBe('2026-10-05');
    expect(longDate('Sept. 8, 2026')).toBe('2026-09-08');
  });
});

describe('Middletown agendas', () => {
  const regular = parseMiddletownAgenda(fixture('connecticut/middletown-agenda-2026-10-05.txt'));
  const matters = (items: typeof regular.items) =>
    items.flatMap((i) => {
      const c = classifyMiddletownItem(i, items);
      return c ? [{ ...c, item: i.number }] : [];
    });

  it('reads the time and every lettered item, across page breaks', () => {
    expect(regular.time).toBe('7:00 PM');
    expect(regular.items.length).toBeGreaterThan(40);
    const k = regular.items.find((i) => i.number === '11K')!;
    expect(k.section).toBe('Resolutions, Ordinances, etc.');
    expect(k.text).toMatch(
      /^Approving the 2026 Community Development Block Grant .* Common Council and changing priorities/,
    );
    // A page header between two lines of an item isn't part of it.
    expect(regular.items.find((i) => i.number === '11C')!.text).not.toMatch(/Page \d/);
  });

  it('keeps resolutions, ordinances and appropriations only', () => {
    const list = matters(regular.items);
    expect(list.map((m) => m.item)).toEqual(['7A', ...'ABCDEFGHIJK'.split('').map((l) => `11${l}`)]);
    expect(list[0]).toMatchObject({ type: 'Appropriation', section: 'Appropriations', number: null });
    expect(list[1]).toMatchObject({ type: 'Resolution', section: 'Resolutions and Ordinances' });
  });

  it('reads sub-items and bond ordinances, not the public hearing on them', () => {
    const special = parseMiddletownAgenda(fixture('connecticut/middletown-agenda-2026-08-20.txt'));
    expect(special.time).toBe('6:00 PM');
    const list = matters(special.items);
    expect(list.map((m) => m.item)).toEqual(['3A.i', '3A.ii', '3B', '3C', '3D']);
    expect(list[0]!.type).toBe('Ordinance');
    expect(list[4]!.type).toBe('Resolution');
    // The referendum resolutions run for pages; titles are cut.
    expect(list[2]!.title.length).toBeLessThanOrEqual(1502);
  });

  it('cites numbered resolutions and ordinances carried to a later meeting', () => {
    const items = [
      {
        number: '6A',
        section: 'Old Business',
        text: 'RESOLUTION No. 81-26 – to correct a scrivener’s error Correcting the approved resolution',
      },
      { number: '11B', section: 'Resolutions, Ordinances, etc.', text: 'ORDINANCE No. 02-26: Amending Chapter 272' },
    ];
    expect(classifyMiddletownItem(items[0]!)).toMatchObject({
      type: 'Resolution',
      number: 'Resolution No. 81-26',
      title: 'to correct a scrivener’s error Correcting the approved resolution',
      section: 'Old Business',
    });
    expect(classifyMiddletownItem(items[1]!)).toMatchObject({ type: 'Ordinance', number: 'Ordinance No. 2-26' });
  });

  it('names sections without their instructions', () => {
    expect(sectionName('Appropriations: Mayor requests Council Clerk to read appropriation requests')).toBe(
      'Appropriations',
    );
    expect(sectionName('Call to Order NOTE: if calling from a phone')).toBe('Call to Order');
    expect(sectionName('Public Hearings -- Proposed Bond Ordinances')).toBe('Public Hearings');
  });

  it('finds next to nothing in a layout it doesn’t know', () => {
    expect(parseMiddletownAgenda('AGENDA\nWelcome\nThe council will discuss the budget.\n').items).toEqual([]);
  });
});
