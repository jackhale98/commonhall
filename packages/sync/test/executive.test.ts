import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSenateVote, type FrExecutiveOrder, type NominationListItem } from '@civic/congress-client';
import {
  eoNumbersAfter,
  executiveOrderRow,
  nominationIdFromSenate,
  nominationRow,
  nominationStatus,
  parseNominationDescription,
} from '../src/federal/executive.ts';
import { senateVoteRow } from '../src/federal/votes.ts';

const fixture = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../congress-client/test/fixtures/${path}`, import.meta.url), 'utf8'));

describe('executive orders', () => {
  it('maps a Federal Register document', () => {
    const [doc] = fixture('federal-register/executive-orders.json').results as FrExecutiveOrder[];
    expect(executiveOrderRow(doc!)).toMatchObject({
      document_number: '2026-20321',
      eo_number: 14434,
      title: 'Inaugurating the Era of Super Intelligence',
      president: 'donald-trump',
      president_name: 'Donald Trump',
      signing_date: '2026-09-29',
      publication_date: '2026-10-02',
      citation: '91 FR 63129',
      revokes: [],
    });
  });

  it('reads revocations from disposition notes', () => {
    const notes = 'Revokes: EO 14148, January 20, 2025; EO 14151, January 20, 2025; See: EO 14252, March 27, 2025';
    expect(eoNumbersAfter(notes, /^Revokes\b/)).toEqual([14148, 14151]);
    expect(eoNumbersAfter('Revoked by: EO 14148, January 20, 2025', /^Revoked by\b/)).toEqual([14148]);
    expect(eoNumbersAfter('See: EO 14252', /^Revokes\b/)).toEqual([]);
    expect(eoNumbersAfter(null, /^Revokes\b/)).toEqual([]);
  });
});

describe('nominations', () => {
  const items = fixture('congress/nominations-sample.json').nominations as NominationListItem[];

  it('maps list items, including split nominations and military lists', () => {
    expect(nominationRow(items[0]!)).toMatchObject({
      id: '119-pn615-2',
      part: 2,
      nominee: 'Alexander C. Van Hook',
      position: 'United States District Judge for the Western District of Louisiana',
      organization: 'The Judiciary',
      status: 'confirmed',
      is_military: false,
    });
    expect(nominationRow(items[1]!)).toMatchObject({
      id: '119-pn373',
      part: null,
      nominee: 'Sara Bailey',
      position: 'Director of National Drug Control Policy',
      status: 'confirmed',
    });
    expect(nominationRow(items[2]!)).toMatchObject({
      status: 'in_committee',
      position: 'an Assistant Secretary of Commerce',
    });
    expect(nominationRow(items[3]!)).toMatchObject({ is_military: true, nominee: null, status: 'confirmed' });
  });

  it('matches the Senate vote document numbering', () => {
    expect(nominationIdFromSenate(119, '615-2')).toBe('119-pn615-2');
    expect(nominationIdFromSenate(119, '373')).toBe('119-pn373');
    expect(nominationIdFromSenate(119, 'S. 5')).toBeNull();
    // Recorded senate.gov roll call 658 (2025): cloture on PN615-2.
    const xml = readFileSync(
      new URL('../../congress-client/test/fixtures/senate/vote_119_1_00658.xml', import.meta.url),
      'utf8',
    );
    expect(senateVoteRow(parseSenateVote(xml))).toMatchObject({ nomination_id: '119-pn615-2', bill_id: null });
  });

  it('reads the status from the latest action', () => {
    expect(nominationStatus('Placed on Senate Executive Calendar. Calendar Number 300.')).toBe('on_calendar');
    expect(nominationStatus('Committee on the Judiciary. Reported by Senator Grassley without printed report.')).toBe(
      'reported',
    );
    expect(nominationStatus('Received message of withdrawal of nomination from the President.')).toBe('withdrawn');
    expect(nominationStatus('Returned to the President under the provisions of Senate Rule XXXI.')).toBe('returned');
    expect(parseNominationDescription('Unparseable text')).toEqual({ nominee: null, position: null });
  });
});
