import { describe, expect, it } from 'vitest';
import {
  CouncillorIndex,
  cambridgeMatterId,
  cambridgeMeetingKind,
  cambridgeOfficialId,
  citationLabel,
  citationOf,
  oneEditApart,
  parseCambridgeActions,
  parseCitation,
  stripTitle,
} from '../src/cambridge.ts';
import { ShapeError } from '../src/shape.ts';
import { fixture } from './helpers.ts';

const cambridge = (name: string) => fixture(`cambridge/${name}`);

describe('Cambridge citations', () => {
  it('reads both systems’ forms as one key', () => {
    const iqm2 = parseCitation('POR 2025 #171')!;
    expect(iqm2).toEqual({ prefix: 'POR', year: 2025, number: 171 });
    expect(parseCitation('ORD 2025 # 16')).toEqual({ prefix: 'ORD', year: 2025, number: 16 });
    expect(parseCitation('POR 2025-171')).toEqual(iqm2);
    expect(parseCitation('COM 3651 #2025')).toEqual({ prefix: 'COM', year: 2025, number: 3651 });
    expect(citationOf('CMA 2025 #305 : 12.22.25 Federal Update')).toEqual({ prefix: 'CMA', year: 2025, number: 305 });
    expect(citationLabel(iqm2)).toBe('POR 2025-171');
    expect(cambridgeMatterId(iqm2)).toBe('ma-cambridge-220250171');
    expect(cambridgeMatterId(parseCitation('CMA 2026-280')!)).toBe('ma-cambridge-120260280');
  });

  it('leaves out public communications, applications and awaiting-report lists', () => {
    for (const c of ['COM 3651 #2025', 'APP 2025 #44', 'AR 2026-14', 'COF 2026-120'])
      expect(cambridgeMatterId(parseCitation(c)!)).toBeNull();
    expect(parseCitation('ARS-25-33')).toBeNull();
  });
});

describe('Cambridge councillors', () => {
  const index = new CouncillorIndex(
    ['Ayah A. Al-Zubi', 'Marc C. McGovern', 'Jivan Sobrinho-Wheeler', 'Sumbul Siddiqui', 'E. Denise Simmons'].map(
      (name) => ({ id: cambridgeOfficialId(name), name }),
    ),
  );

  it('makes ids from first and last names', () => {
    expect(cambridgeOfficialId('Marc C. McGovern')).toBe('ma-cambridge-marc-mcgovern');
    expect(cambridgeOfficialId('Councillor Ayah A. Al-Zubi')).toBe('ma-cambridge-ayah-al-zubi');
    expect(cambridgeOfficialId('E. Denise Simmons')).toBe('ma-cambridge-denise-simmons');
    expect(stripTitle('Vice Mayor Burhan Azeem – 5:50 PM')).toBe('Burhan Azeem');
  });

  it('finds people however the clerk printed them', () => {
    expect(index.find('Marc McGovern')).toBe('ma-cambridge-marc-mcgovern');
    expect(index.find('COUNCILLOR MCGOVERN')).toBe('ma-cambridge-marc-mcgovern');
    expect(index.find('Councillor Sobrinho-Wheeler')).toBe('ma-cambridge-jivan-sobrinho-wheeler');
    expect(index.find('COUNCILLOR SOBRINHO WHEELER')).toBe('ma-cambridge-jivan-sobrinho-wheeler');
    expect(index.find('MAYOR SIDDIQUII')).toBe('ma-cambridge-sumbul-siddiqui');
    expect(index.find('COUNCILLOR AL-ZUB')).toBe('ma-cambridge-ayah-al-zubi');
    expect(index.find('COUNCILLLOR SIMMONS')).toBe('ma-cambridge-denise-simmons');
    expect(index.find('Councillor Toner')).toBeNull();
    expect(oneEditApart('nolan', 'noland')).toBe(true);
    expect(oneEditApart('nolan', 'zusy')).toBe(false);
  });
});

describe('Cambridge meetings', () => {
  it('tells council and committee meetings from boards', () => {
    expect(cambridgeMeetingKind('Regular City Council Meeting')).toEqual({ committees: [], cancelled: false });
    expect(cambridgeMeetingKind('Regular City Council Meeting-CANCELLED')).toEqual({ committees: [], cancelled: true });
    expect(cambridgeMeetingKind('Regular Meeting').committees).toEqual([]);
    expect(cambridgeMeetingKind('The Ordinance Committee').committees).toEqual(['Ordinance Committee']);
    expect(cambridgeMeetingKind('Transportation and Public Utilities').committees).toEqual([
      'Transportation and Public Utilities Committee',
    ]);
    expect(
      cambridgeMeetingKind('Economic Development and University Relations Committee & Finance Committee').committees,
    ).toEqual(['Finance Committee', 'Economic Development and University Relations Committee']);
    expect(cambridgeMeetingKind('CANCELED - The Health and Environment Committee')).toEqual({
      committees: ['Health and Environment Committee'],
      cancelled: true,
    });
    for (const board of [
      'Water Board',
      'Bicycle Committee Meeting',
      "Citizens' Committee on Civic Unity",
      'Planning Board Meeting',
    ])
      expect(cambridgeMeetingKind(board).committees).toBeNull();
  });
});

describe('PrimeGov final actions', () => {
  it('reads items, sponsors, results and roll calls', () => {
    const record = parseCambridgeActions(cambridge('primegov-final-actions.html'));
    expect(record).toMatchObject({ kind: 'final actions', date: '2026-10-05' });
    expect(record.present).toHaveLength(9);
    expect(record.absent).toEqual([]);
    const por = record.items.find((i) => citationLabel(i.citation) === 'POR 2026-185')!;
    expect(por.section).toBe('POLICY ORDERS');
    expect(por.title).toMatch(/^That the proposed language for "Tenant Notification of Property Sale"/);
    expect(por.sponsors).toEqual([
      'COUNCILLOR SOBRINHO-WHEELER',
      'COUNCILLOR AL-ZUBI',
      'COUNCILLOR MCGOVERN',
      'MAYOR SIDDIQUI',
      'COUNCILLOR NOLAN',
    ]);
    expect(por.vote).toMatchObject({
      result: 'Referred to Ordinance Committee as amended',
      yes: 9,
      no: 0,
      voice: false,
    });
    expect(por.vote!.yeas).toHaveLength(9);
    const split = record.items.find((i) => citationLabel(i.citation) === 'POR 2026-181')!;
    expect(split.section).toBe('CHARTER RIGHT');
    expect(split.vote).toMatchObject({ yes: 6, no: 3 });
    expect(split.vote!.nays).toHaveLength(3);
    expect(record.items.find((i) => i.citation.prefix === 'ORD')?.vote?.result).toBe('ORDAINED');
  });

  it('reads results printed on one line, and voice votes without names', () => {
    const record = parseCambridgeActions(cambridge('primegov-final-actions-voice.html'));
    const cma = record.items.find((i) => citationLabel(i.citation) === 'CMA 2026-268')!;
    expect(cma.vote).toMatchObject({ result: 'Approved and CMA Placed on File', yes: 9, no: 0 });
    const voice = record.items.find((i) => citationLabel(i.citation) === 'POR 2026-174')!;
    expect(voice.vote).toMatchObject({ result: 'Adopted', voice: true, yeas: [] });
    const failed = record.items.find((i) => citationLabel(i.citation) === 'POR 2026-179')!;
    expect(failed.vote).toMatchObject({ result: 'FAILED', yes: 2, no: 4 });
  });

  it('reads an agenda before the meeting (no results) with its notes', () => {
    const record = parseCambridgeActions(cambridge('primegov-agenda.html'));
    expect(record.kind).toBe('agenda');
    expect(record.items.length).toBeGreaterThan(3);
    expect(record.items.every((i) => i.vote === null)).toBe(true);
    const charter = record.items.find((i) => citationLabel(i.citation) === 'POR 2026-181');
    expect(charter?.notes[0]).toMatch(/^CHARTER RIGHT EXERCISED BY COUNCILLOR ZUSY/);
  });

  it('refuses a page that is not a meeting', () => {
    expect(() => parseCambridgeActions('<html><body><p>Down for maintenance</p></body></html>')).toThrow(ShapeError);
  });
});
