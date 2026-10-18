/**
 * Massachusetts governors' executive orders into `state_executive_orders`, from the
 * Trial Court Law Libraries' list on mass.gov. mass.gov turns away plain requests, so
 * the script reads the pages in a headless browser and hands this loader what it
 * needs: a page's links and an order page's text. Reads the newest two index pages
 * (orders 500 and up, about fifteen years), and opens an order's own page (its date,
 * governor, register number and a short summary of what it does and why) only when
 * the order is new or that is missing. Run by scripts/load-ma-orders.ts ("Load
 * governor orders").
 */
import {
  MA_ORDERS_INDEX,
  maOrderRangePages,
  maOrderSummary,
  parseMaOrderDetail,
  parseMaOrderLinks,
  type MaOrderLink,
} from '@civic/congress-client';
import type { Sql } from '../db.ts';

const STATE = 'MA';
/** Two index pages list well over a hundred orders: far fewer means the layout has changed. */
export const MA_MIN_ORDERS = 20;

/** A link on a page, as the browser reads it (the link's text and its absolute href). */
export interface PageLink {
  text: string;
  href: string;
}

/** mass.gov as a browser reads it. Both throw when a page does not load. */
export interface MaOrdersSite {
  /** The links in a page's main content. */
  links(url: string): Promise<PageLink[]>;
  /** A page's main content as text (the browser's innerText). */
  text(url: string): Promise<string>;
}

export interface MaOrdersOptions {
  site: MaOrdersSite;
  /** How many index pages (a hundred orders each) to read, newest first. */
  ranges?: number;
  minOrders?: number;
  log?: (message: string) => void;
}

/** Load the newest index pages and any new or incomplete orders; returns the rows written. */
export async function loadMaOrders(sql: Sql, options: MaOrdersOptions): Promise<number> {
  const { site, ranges = 2, minOrders = MA_MIN_ORDERS, log = () => undefined } = options;
  const pages = maOrderRangePages(await site.links(MA_ORDERS_INDEX)).slice(0, ranges);
  const orders: MaOrderLink[] = [];
  for (const range of pages) orders.push(...parseMaOrderLinks(await site.links(range)));
  // A changed layout reads as few or no orders: fail loudly rather than load nothing.
  if (orders.length < minOrders) throw new Error(`Read only ${orders.length} orders; has mass.gov's layout changed?`);

  const known = new Map(
    (
      await sql<{ number: number; complete: boolean }[]>`
        select number, (signed_date is not null and (summary is not null or reason is not null)) as complete
          from public.state_executive_orders where state = ${STATE}`
    ).map((r) => [Number(r.number), r.complete]),
  );
  let written = 0;
  for (const order of orders) {
    const row = {
      state: STATE,
      number: order.number,
      label: String(order.number),
      title: order.title,
      url: order.url,
    };
    if (known.get(order.number)) {
      // Titles are corrected now and then; dates and issuers don't change.
      const changed = await sql`
        update public.state_executive_orders set title = ${row.title}, url = ${row.url}
         where state = ${STATE} and number = ${row.number} and (title <> ${row.title} or url <> ${row.url})
        returning 1`;
      written += changed.length;
      continue;
    }
    const { body, ...fields } = parseMaOrderDetail(await site.text(order.url));
    // A short summary, not the full text: that stays on mass.gov.
    const detail = { ...fields, ...(body ? maOrderSummary(body) : { summary: null, reason: null }) };
    await sql`
      insert into public.state_executive_orders ${sql({ ...row, ...detail })}
      on conflict (state, number) do update set
        title = excluded.title, url = excluded.url, signed_date = excluded.signed_date,
        governor = excluded.governor, revokes = excluded.revokes, register = excluded.register,
        summary = excluded.summary, reason = excluded.reason`;
    written++;
    log(`No. ${order.number} ${detail.signed_date ?? 'no date'} ${detail.governor ?? ''}`);
  }
  log(JSON.stringify({ orders: orders.length, written }));
  return written;
}
