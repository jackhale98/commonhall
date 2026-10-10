import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyAgendaItem, parseAgendaHtml, parseAgendaText } from '../src/worcester-agenda.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/worcester/${name}`, import.meta.url), 'utf8');
const pdf = parseAgendaText(fixture('agenda-2026-10-06.txt'));
const html = parseAgendaHtml(fixture('agenda-2026-01-13.html'));
const byNumber = (items: typeof pdf, n: string) => items.find((i) => i.number === n)!;

describe('Worcester agendas (PDF text)', () => {
  it('reads every item in order, with its section', () => {
    expect(pdf).toHaveLength(108);
    expect(pdf.slice(0, 3).map((i) => i.number)).toEqual(['5a', '6a', '7a']);
    expect(byNumber(pdf, '12a').section).toBe('ORDERS');
    // A section heading that wraps onto a second line.
    expect(byNumber(pdf, '15a').section).toBe('REPORTS OF THE COMMITTEE ON PUBLIC SERVICE AND TRANSPORTATION');
  });

  it('gives each item the action asked for its run of items', () => {
    expect(byNumber(pdf, '9a').action).toBe('Refer to Traffic and Parking Committee');
    expect(byNumber(pdf, '9k').action).toBe('Refer to Traffic and Parking Committee');
    expect(byNumber(pdf, '9l').action).toBe('Set Hearing for October 13, 2026 at 6:30 p.m.');
    expect(byNumber(pdf, '14c').action).toBe('Accept');
    expect(byNumber(pdf, '12a').action).toBeNull();
  });

  it('classifies items and finds their sponsors', () => {
    expect(classifyAgendaItem(byNumber(pdf, '12a'))).toEqual({
      type: 'Order',
      title:
        'Request City Manager request Commissioner of Transportation and Mobility review the entrance to Flagg St. from Pleasant St. for the purpose of providing City Council with a report concerning the feasibility and advisability of narrowing the road at the intersection, in an effort to slow down speeding vehicles and make drivers in the area more cautious (see attached).',
      sponsors: ['Rivera'],
    });
    expect(classifyAgendaItem(byNumber(pdf, '9b'))).toMatchObject({
      type: 'Petition',
      sponsors: ['Robert A. Bilotta'],
    });
    expect(classifyAgendaItem(byNumber(pdf, '9a'))).toMatchObject({ type: 'Petition', sponsors: [] });
    // No dash after the name; a hyphenated word later in the text is not the separator.
    expect(classifyAgendaItem(byNumber(pdf, '17c'))).toMatchObject({
      type: 'Order',
      sponsors: ['Morris A. Bergman'],
      title: expect.stringMatching(/^That the City Council of the City of Worcester does hereby adopt item/),
    });
    expect(classifyAgendaItem(byNumber(pdf, '14a'))).toMatchObject({ type: 'Committee report', sponsors: [] });
    expect(classifyAgendaItem(byNumber(pdf, '13a'))).toMatchObject({ type: 'Resolution', sponsors: ['Fresolo'] });
  });

  it('leaves out procedure', () => {
    expect(classifyAgendaItem(byNumber(pdf, '5a'))).toBeNull();
    expect(classifyAgendaItem(byNumber(pdf, '6a'))).toBeNull();
    expect(classifyAgendaItem(byNumber(pdf, '12p'))).toBeNull();
  });
});

describe('Worcester agendas (HTML)', () => {
  it("reads sections, sub-sections and the City Manager's numbered items", () => {
    expect(html).toHaveLength(141);
    const cm = byNumber(html, '11.35a');
    expect(cm.section).toMatch(/^COMMUNICATIONS OF THE CITY MANAGER: FINANCE ITEMS/);
    expect(classifyAgendaItem(cm)).toMatchObject({ type: 'City Manager communication', sponsors: [] });
  });

  it('finds several sponsors and ordinances', () => {
    expect(classifyAgendaItem(byNumber(html, '9c'))?.sponsors).toEqual(['Joseph M. Petty', 'Jose A. Rivera']);
    expect(classifyAgendaItem(byNumber(html, '21f'))).toMatchObject({
      type: 'Order',
      sponsors: ['Etel Haxhiaj', 'Thu Nguyen'],
    });
    const types = html
      .map(classifyAgendaItem)
      .filter((c) => c !== null)
      .map((c) => c.type);
    expect(types.filter((t) => t === 'Ordinance')).toHaveLength(7);
  });
});
