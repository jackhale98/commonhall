import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  maOrderParts,
  maOrderRangePages,
  maOrderSummary,
  parseMaOrderDetail,
  parseMaOrderLinks,
} from '../src/mass-orders.ts';

describe('Massachusetts executive orders', () => {
  it('finds the index page for each hundred, newest first', () => {
    expect(
      maOrderRangePages([
        {
          text: 'Executive Orders 500-599',
          href: 'https://www.mass.gov/law-library/massachusetts-executive-orders-500-599',
        },
        {
          text: 'Executive Orders 600-699',
          href: 'https://www.mass.gov/law-library/massachusetts-executive-orders-600-699',
        },
        { text: 'Executive Orders A-D', href: 'https://www.mass.gov/info-details/by-subject-a-d' },
      ]),
    ).toEqual([
      'https://www.mass.gov/law-library/massachusetts-executive-orders-600-699',
      'https://www.mass.gov/law-library/massachusetts-executive-orders-500-599',
    ]);
  });

  it('reads the orders an index page links', () => {
    expect(
      parseMaOrderLinks([
        { text: 'Trial Court Law Libraries', href: 'https://www.mass.gov/orgs/trial-court-law-libraries' },
        {
          text: 'No. 610: Reconstituting the Judicial Nominating Commission and Establishing a Code of Conduct for Commission Members and Nominees to Judicial Oﬃce',
          href: 'https://www.mass.gov/executive-orders/no-610-reconstituting',
        },
        {
          text: 'No. 601: Rescinding Executive Order No. 600',
          href: 'https://www.mass.gov/executive-orders/no-601-rescinding',
        },
      ]),
    ).toEqual([
      {
        number: 601,
        title: 'Rescinding Executive Order No. 600',
        url: 'https://www.mass.gov/executive-orders/no-601-rescinding',
      },
      {
        number: 610,
        title:
          'Reconstituting the Judicial Nominating Commission and Establishing a Code of Conduct for Commission Members and Nominees to Judicial Office',
        url: 'https://www.mass.gov/executive-orders/no-610-reconstituting',
      },
    ]);
  });

  it("reads an order's date, issuer and what it revokes", () => {
    const text = `EXECUTIVE ORDER
Executive Order
No. 635: Affirming and Reconstituting a State Rehabilitation Advisory Council
DATE:\t
08/15/2024

ISSUER:\t
Maura Healey

MASS REGISTER:\t
No. 1529

REVOKING AND SUPERSEDING:\t
Executive Order No. 368

WHEREAS, the provision of comprehensive …`;
    expect(parseMaOrderDetail(text)).toEqual({
      signed_date: '2024-08-15',
      governor: 'Maura Healey',
      revokes: 'Executive Order No. 368',
      register: 'No. 1529',
      body: 'WHEREAS, the provision of comprehensive …',
    });
    expect(parseMaOrderDetail('DATE:\t\n01/05/2023\n\nISSUER:\t\nMaura Healey\n\nWHEREAS …')).toMatchObject({
      signed_date: '2023-01-05',
      governor: 'Maura Healey',
      revokes: null,
      register: null,
    });
  });
});

describe("an order's text", () => {
  const read = (name: string) => readFileSync(new URL(`./fixtures/mass-orders/${name}`, import.meta.url), 'utf8');

  it('keeps the register number, what it rescinds and its text without the page around it', () => {
    const d = parseMaOrderDetail(read('order-601.txt'));
    expect(d).toMatchObject({ signed_date: '2022-08-24', governor: 'Charlie Baker', register: 'No. 1478' });
    expect(d.revokes).toBe('Executive Order No. 600');
    expect(d.body).toMatch(/^WHEREAS, the Constitution/);
    expect(d.body).toMatch(/Given at the Executive Chamber in Boston this 24th day of August/);
    expect(d.body).not.toMatch(/THIS IS PART OF|Help Us Improve/);
  });

  it('splits the text into why and what it orders', () => {
    const parts601 = maOrderParts(parseMaOrderDetail(read('order-601.txt')).body!);
    expect(parts601.whereas).toHaveLength(2);
    expect(parts601.whereas[1]).toMatch(/^the law enacted by the Legislature .* is unnecessary\.$/);
    expect(parts601.sections).toEqual([
      { heading: null, text: 'Executive Order No. 600 is rescinded effective immediately.' },
    ]);

    const parts658 = maOrderParts(parseMaOrderDetail(read('order-658.txt')).body!);
    expect(parts658.whereas).toEqual([
      'demand for data storage, processing capabilities, and computational tasks is increasing.',
      'data centers are energy- and resource-intensive facilities.',
    ]);
    expect(parts658.sections).toEqual([
      {
        heading: 'Section 1',
        text: 'The Department of Public Utilities shall open a proceeding on data center rates.',
      },
      {
        heading: 'Section 2',
        text: 'Data centers shall report their water use annually.\n\nEach report shall be public.',
      },
      { heading: 'Section 15', text: 'This Executive Order shall be effective upon the date signed.' },
    ]);
  });

  it("reads an amending order's text, which has no WHEREAS", () => {
    const d = parseMaOrderDetail(
      'No. 634: Amendment to Executive Order 631\nDATE:\t\n06/27/2024\n\nISSUER:\t\nMaura Healey\n\nMASS REGISTER:\t\nNo. 1525\n\nAMENDING:\t\nExecutive Order No. 631\n\nSection 2 of Executive Order 631 is hereby amended by striking the words “up to 15 additional members”.\n\nTHIS IS PART OF: Massachusetts Executive Orders 600-699\n',
    );
    expect(d.body).toBe(
      'Section 2 of Executive Order 631 is hereby amended by striking the words “up to 15 additional members”.',
    );
    expect(maOrderParts(d.body!).sections).toEqual([
      {
        heading: null,
        text: 'Section 2 of Executive Order 631 is hereby amended by striking the words “up to 15 additional members”.',
      },
    ]);
  });

  it('summarizes an order in a line or two', () => {
    const read658 = parseMaOrderDetail(read('order-658.txt')).body!;
    expect(maOrderSummary(read658)).toEqual({
      summary: 'The Department of Public Utilities shall open a proceeding on data center rates.',
      reason: 'Demand for data storage, processing capabilities, and computational tasks is increasing.',
    });
    const long = maOrderSummary(
      `WHEREAS, ${'a reason that goes on '.repeat(20)};\n\nNOW, THEREFORE, I do hereby order as follows:\n\nSECTION 1.\n\n${'The agency shall do a thing '.repeat(20)}.`,
    );
    expect(long.summary!.length).toBeLessThanOrEqual(281);
    expect(long.summary).toMatch(/…$/);
    expect(long.reason!.length).toBeLessThanOrEqual(201);
    // Definitions say nothing about what an order does.
    expect(
      maOrderSummary(
        'NOW, THEREFORE, I do hereby order as follows:\n\nSECTION 1.\n\nFor purposes of this Executive Order, the following terms shall have the following meanings:\n\nSECTION 2.\n\nThe Executive Office of Public Safety shall protect places of worship.',
      ).summary,
    ).toBe('The Executive Office of Public Safety shall protect places of worship.');
    expect(
      maOrderSummary(
        'NOW, THEREFORE, I do hereby order as follows:\n\nSECTION 1.\n\nDefinition of "Total Medical Expenses (TME)." As used in this Executive Order, TME refers to spending.\n\nSECTION 2.\n\nThe Secretary shall set a primary care spending target.',
      ).summary,
    ).toBe('The Secretary shall set a primary care spending target.');
  });

  it('keeps titled sections ("Section 1. Purpose") as headings', () => {
    expect(
      maOrderParts('NOW, THEREFORE, I do hereby order as follows:\n\nSection 1. Purpose\n\nA council is established.')
        .sections,
    ).toEqual([{ heading: 'Section 1. Purpose', text: 'A council is established.' }]);
  });
});
