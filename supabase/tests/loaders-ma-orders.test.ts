import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MA_ORDERS_INDEX } from '@civic/congress-client';
import { loadMaOrders, type MaOrdersSite } from '@civic/sync/loaders';
import type { Sql } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;

const RANGE_600 = 'https://www.mass.gov/law-library/massachusetts-executive-orders-600-699';
const RANGE_500 = 'https://www.mass.gov/law-library/massachusetts-executive-orders-500-599';
const RANGE_400 = 'https://www.mass.gov/law-library/massachusetts-executive-orders-400-499';
/** 601 and 658 are the recorded pages; the rest are made up in the same layout. */
const NEWER = [601, 658, ...Array.from({ length: 18 }, (_, i) => 620 + i)];
const OLDER = [550, 551, 552];
const NUMBERS = [...NEWER, ...OLDER, 450];

const clean = () => sql`delete from public.state_executive_orders where state = 'MA' and number = any(${NUMBERS})`;
beforeEach(clean);
afterAll(async () => {
  await clean();
  await sql.end();
});

const fixture = (name: string) =>
  readFileSync(new URL(`../../packages/congress-client/test/fixtures/mass-orders/${name}`, import.meta.url), 'utf8');

const orderUrl = (n: number) => `https://www.mass.gov/executive-orders/no-${n}-an-order`;
const orderLinks = (numbers: number[]) => [
  { text: 'Trial Court Law Libraries', href: 'https://www.mass.gov/orgs/trial-court-law-libraries' },
  ...numbers.map((n) => ({ text: `No. ${n}: Order number ${n}`, href: orderUrl(n) })),
];
const madeUpOrder = (n: number) =>
  `EXECUTIVE ORDER\nNo. ${n}: Order number ${n}\nDATE:\t\n01/05/2023\n\nISSUER:\t\nMaura Healey\n\n` +
  `WHEREAS, order ${n} has a reason;\n\nNOW, THEREFORE, I do hereby order as follows:\n\nSECTION 1.\n\n` +
  `The agency shall carry out order ${n}.\n\nTHIS IS PART OF: Massachusetts Executive Orders\n`;

/** mass.gov as the browser reads it: the main index, an index page per hundred and each order's text. */
function fakeSite(range600 = orderLinks(NEWER)) {
  const opened: string[] = [];
  const site: MaOrdersSite = {
    links: async (url) => {
      if (url === MA_ORDERS_INDEX)
        return [
          { text: 'Executive Orders 400-499', href: RANGE_400 },
          { text: 'Executive Orders 600-699', href: RANGE_600 },
          { text: 'Executive Orders 500-599', href: RANGE_500 },
          { text: 'Executive Orders A-D', href: 'https://www.mass.gov/info-details/by-subject-a-d' },
        ];
      if (url === RANGE_600) return range600;
      if (url === RANGE_500) return orderLinks(OLDER);
      if (url === RANGE_400) return orderLinks([450]);
      throw new Error(`${url}: 404`);
    },
    text: async (url) => {
      opened.push(url);
      const n = Number(/no-(\d+)-/.exec(url)![1]);
      return n === 601 || n === 658 ? fixture(`order-${n}.txt`) : madeUpOrder(n);
    },
  };
  return { site, opened };
}

interface OrderRow {
  number: number;
  title: string;
  signed_date: string | null;
  governor: string | null;
  revokes: string | null;
  register: string | null;
  summary: string | null;
  reason: string | null;
}

const rows = () =>
  sql<OrderRow[]>`
    select number, title, signed_date::text, governor, revokes, register, summary, reason
      from public.state_executive_orders where state = 'MA' and number = any(${NUMBERS}) order by number`;

describe('Load MA governor orders', () => {
  it('reads the newest two index pages, opens each new order once, and writes nothing on a rerun', async () => {
    const first = fakeSite();
    expect(await loadMaOrders(sql, { site: first.site })).toBe(NEWER.length + OLDER.length);
    expect(first.opened).toHaveLength(NEWER.length + OLDER.length);
    const loaded = await rows();
    // The 400s are a third index page: not read.
    expect(loaded.map((r) => r.number)).toEqual([...NEWER, ...OLDER].sort((a, b) => a - b));
    expect(loaded.find((r) => r.number === 601)).toEqual({
      number: 601,
      title: 'Order number 601',
      signed_date: '2022-08-24',
      governor: 'Charlie Baker',
      revokes: 'Executive Order No. 600',
      register: 'No. 1478',
      summary: 'Executive Order No. 600 is rescinded effective immediately.',
      reason: expect.stringMatching(/^The Constitution of the Commonwealth provides/),
    });
    expect(loaded.find((r) => r.number === 658)).toMatchObject({
      signed_date: '2026-09-08',
      governor: 'Maura Healey',
      register: 'No. 1583',
      summary: 'The Department of Public Utilities shall open a proceeding on data center rates.',
    });

    const again = fakeSite();
    expect(await loadMaOrders(sql, { site: again.site })).toBe(0);
    expect(again.opened).toHaveLength(0);
  });

  it('updates a corrected title without opening the order, and reopens an incomplete one', async () => {
    await loadMaOrders(sql, { site: fakeSite().site });
    await sql`update public.state_executive_orders set signed_date = null where state = 'MA' and number = 620`;
    const links = orderLinks(NEWER).map((l) =>
      l.href === orderUrl(621) ? { ...l, text: 'No. 621: Order number 621, corrected' } : l,
    );
    const site = fakeSite(links);
    expect(await loadMaOrders(sql, { site: site.site })).toBe(2);
    expect(site.opened).toEqual([orderUrl(620)]);
    const loaded = await rows();
    expect(loaded.find((r) => r.number === 620)!.signed_date).toBe('2023-01-05');
    expect(loaded.find((r) => r.number === 621)!.title).toBe('Order number 621, corrected');
  });

  it('refuses index pages with too few orders (a changed layout)', async () => {
    const site = fakeSite(orderLinks([]));
    await expect(loadMaOrders(sql, { site: site.site })).rejects.toThrow(/Read only 3 orders/);
    expect(site.opened).toHaveLength(0);
    expect(await rows()).toHaveLength(0);
  });
});
