import { describe, expect, it } from 'vitest';
import { maOrderRangePages, parseMaOrderDetail, parseMaOrderLinks } from '../src/mass-orders.ts';

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
    });
    expect(parseMaOrderDetail('DATE:\t\n01/05/2023\n\nISSUER:\t\nMaura Healey\n\nWHEREAS …')).toEqual({
      signed_date: '2023-01-05',
      governor: 'Maura Healey',
      revokes: null,
    });
  });
});
