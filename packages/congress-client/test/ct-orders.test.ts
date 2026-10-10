import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ctGovernor,
  ctOrderBody,
  ctOrderLabel,
  ctOrderNumber,
  ctOrderSummary,
  ctOrders,
  ctOrdersPageUrl,
  ctTextIsClean,
  parseCtOrderList,
} from '../src/ct-orders.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/ct-orders/${name}`, import.meta.url), 'utf8');

describe('Connecticut executive orders', () => {
  it('reads the list: date, heading, description, PDF and folder', () => {
    const list = parseCtOrderList(fixture('list.html'));
    expect(list.total).toBe(230);
    expect(list.items).toHaveLength(8);
    expect(list.items[0]).toEqual({
      heading: 'Executive Order No. 26-3',
      description: "Establishes the Governor's Blue-Ribbon Commission on K-12 Education Funding and Accountability",
      signed_date: '2026-04-16',
      url: 'https://portal.ct.gov/governor/-/media/office-of-the-governor/executive-orders/lamont-executive-orders/executive-order-no-26-3.pdf?rev=2c8d6d05e4284482bba681075f7c5883',
      folder: 'lamont-executive-orders',
    });
    expect(list.items.at(-1)).toMatchObject({
      heading: 'Governor Dannel P. Malloy - Executive Order No. 1',
      folder: 'others',
    });
  });

  it('keeps the governor’s own orders, with labels and sortable numbers', () => {
    const { orders, skipped } = ctOrders(parseCtOrderList(fixture('list.html')).items);
    expect(skipped).toEqual([]);
    expect(orders.map((o) => [o.label, o.number, o.signed_date, o.governor])).toEqual([
      ['26-3', 202603, '2026-04-16', 'Ned Lamont'],
      ['26-1', 202601, '2026-01-15', 'Ned Lamont'],
      ['14F', 1406, '2022-01-19', 'Ned Lamont'],
      ['7OOO', 767, '2020-08-21', 'Ned Lamont'],
      ['7KK', 737, '2020-05-07', 'Ned Lamont'],
      ['1', 100, '2019-04-24', 'Ned Lamont'],
    ]);
    // The office's description is the title.
    expect(orders[0]!.title).toMatch(/^Establishes the Governor's Blue-Ribbon Commission/);
  });

  it('numbers labels so they sort and never collide', () => {
    expect(ctOrderLabel('Executive Order No. 26-3')).toBe('26-3');
    expect(ctOrderLabel('Executive Order No 7kk')).toBe('7KK');
    expect(ctOrderLabel('Press release')).toBeNull();
    expect(ctOrderNumber('7')).toBe(700);
    expect(ctOrderNumber('7A')).toBe(701);
    expect(ctOrderNumber('7Z')).toBe(726);
    expect(ctOrderNumber('7AA')).toBe(727);
    expect(ctOrderNumber('7ZZ')).toBe(752);
    expect(ctOrderNumber('7AAA')).toBe(753);
    expect(ctOrderNumber('7OOO')).toBe(767);
    expect(ctOrderNumber('21-1')).toBe(202101);
    // Mixed letters aren't part of either series.
    expect(ctOrderNumber('7AB')).toBeNull();
    expect(ctGovernor('lamont-executive-orders')).toBe('Ned Lamont');
    expect(ctGovernor('smith-executive-orders')).toBe('Smith');
    expect(ctGovernor('others')).toBeNull();
    expect(ctOrdersPageUrl(2)).toBe(
      'https://portal.ct.gov/governor/governors-actions/executive-orders?Page=2&PageSize=50',
    );
  });

  it('reads what an order does and why from a text PDF', () => {
    const text = fixture('eo-7ooo.txt');
    expect(ctTextIsClean(text)).toBe(true);
    expect(ctOrderSummary(text)).toEqual({
      summary:
        'Extension of Expanded Outdoor Dining. All provisions of Executive Order No. 7MM and any approvals issued under it shall be extended through November 12, 2020.',
      reason:
        'On March 10, 2020, I issued a declaration of public health and civil preparedness emergencies, proclaiming a state of emergency throughout the State of Connecticut as a result of the coronavirus…',
    });
  });

  it('joins clauses split by page breaks and skips definitions', () => {
    const text = fixture('eo-14f.txt');
    const body = ctOrderBody(text)!;
    // A WHEREAS clause broken across pages is one paragraph.
    expect(body).toContain('recommended that visitors to nursing homes present proof that they are');
    expect(ctOrderSummary(text).summary).toMatch(
      /^Proof of Vaccination Booster or Testing for Visitors and Primary and Secondary Essential Support Persons\. Notwithstanding/,
    );
  });

  it('does not end a summary at "No." or a lettered item', () => {
    const text = [
      'WHEREAS, the State of Connecticut has declared public health and civil preparedness emergencies; and',
      'NOW, THEREFORE, I, NED LAMONT, Governor of the State of Connecticut, do hereby ORDER AND DIRECT:',
      'I. Extension of Eviction Moratorium. The provisions of Executive Order No. 7X, Section 1, as modified by',
      'Executive Order Nos. 7NN, Section 4, 7DDD, Section 1, and 7OOO, Section 3 shall remain in effect until',
      'January 1, 2021, with the following modifications: a. Notices to quit may be delivered after that date. b.',
      'Other provisions continue.',
    ].join('\n');
    const { summary } = ctOrderSummary(text);
    // Numbers on a line of their own, as in Executive Order No. 22-2.
    expect(
      ctOrderBody(
        'NOW, THEREFORE, I do hereby ORDER AND DIRECT:\nI.\n\nThere is a Commission.\n\nII.\n\nMembership.\na. The Governor.',
      ),
    ).toBe('NOW, THEREFORE, I do hereby ORDER AND DIRECT:\n\nThere is a Commission.\n\nMembership. a. The Governor.');
    expect(summary).toMatch(/^Extension of Eviction Moratorium\. The provisions of Executive Order No\. 7X/);
    expect(summary).not.toMatch(/(No|a)\.$/);
  });

  it('quotes nothing from a scan whose OCR text has errors, or from one with no text', () => {
    const text = fixture('eo-26-3.txt');
    expect(ctTextIsClean(text)).toBe(false);
    expect(ctOrderSummary(text)).toEqual({ summary: null, reason: null });
    expect(ctOrderSummary('\f\f')).toEqual({ summary: null, reason: null });
  });

  it('finds nothing in a page whose layout has changed', () => {
    const list = parseCtOrderList(
      '<html><body><ul><li><a href="/x.pdf">Executive Order No. 26-4</a></li></ul></body></html>',
    );
    expect(list.items).toEqual([]);
    expect(list.total).toBeNull();
  });
});
