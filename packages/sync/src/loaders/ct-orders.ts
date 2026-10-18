/**
 * Connecticut governors' executive orders into `state_executive_orders`, from the
 * Governor's office list on portal.ct.gov (plain requests work). Reads the whole
 * list (about five pages of 50) and keeps the governor's own orders (Lamont's, about
 * 140; earlier governors' numbers repeat his). The list gives each order's date and a
 * one-line description, used as its title. An order's PDF is read only when the order
 * is new or its file changed, for a short summary of what it orders and why (none when
 * the PDF is a scan). Run by scripts/load-ct-orders.ts ("Load CT governor orders").
 */
import {
  checkKept,
  ctOrderSummary,
  ctOrders,
  ctOrdersPageUrl,
  parseCtOrderList,
  type CtOrderListItem,
  type HttpClient,
} from '@civic/congress-client';
import type { Sql } from '../db.ts';
import type { PdfText } from './pdf.ts';

const STATE = 'CT';
const PAGE_SIZE = 50;
/** Governor Lamont alone has issued about 140: far fewer means the page has changed. */
export const CT_MIN_ORDERS = 100;

export interface CtOrdersOptions {
  http: Pick<HttpClient, 'get'>;
  pdfText: PdfText;
  /** Read every order's PDF again. */
  refresh?: boolean;
  minOrders?: number;
  log?: (message: string) => void;
}

/** Load the list and any new or changed orders; returns the rows written. */
export async function loadCtOrders(sql: Sql, options: CtOrdersOptions): Promise<number> {
  const { http, pdfText, refresh = false, minOrders = CT_MIN_ORDERS, log = () => undefined } = options;
  // The whole list, page by page.
  const items: CtOrderListItem[] = [];
  let total: number | null = null;
  for (let page = 1; page <= 20; page++) {
    const list = parseCtOrderList(await (await http.get(ctOrdersPageUrl(page, PAGE_SIZE), 'text/html')).text());
    total ??= list.total;
    items.push(...list.items);
    if (list.items.length === 0 || (total !== null && items.length >= total)) break;
  }
  const { orders, skipped } = ctOrders(items);
  for (const s of skipped) log(`Not an order number: ${s.heading} ${s.url}`);
  checkKept('portal.ct.gov executive orders', orders.length + skipped.length, orders.length);
  // A changed layout reads as few or no orders: fail loudly rather than load nothing.
  if (orders.length < minOrders)
    throw new Error(`Read only ${orders.length} orders (list says ${total ?? '?'}); has portal.ct.gov changed?`);
  const labels = new Map<string, string>();
  for (const o of orders) {
    const other = labels.get(o.label);
    // A new governor restarting at "1" would collide with Lamont's: needs a decision, not a guess.
    if (other && other !== o.url) throw new Error(`Two orders are labelled ${o.label}: ${other} and ${o.url}`);
    labels.set(o.label, o.url);
  }

  const known = new Map(
    (
      await sql<{ number: number; url: string }[]>`
        select number, url from public.state_executive_orders where state = ${STATE}`
    ).map((r) => [Number(r.number), r.url]),
  );
  let written = 0;
  let read = 0;
  for (const order of orders) {
    const row = {
      state: STATE,
      number: order.number,
      label: order.label,
      title: order.title,
      url: order.url,
      signed_date: order.signed_date,
      governor: order.governor,
    };
    if (!refresh && known.get(order.number) === order.url) {
      // Same file: only the list's fields can have changed.
      const changed = await sql`
        update public.state_executive_orders
           set label = ${row.label}, title = ${row.title}, signed_date = ${row.signed_date}, governor = ${row.governor}
         where state = ${STATE} and number = ${row.number}
           and (label, title, signed_date, governor) is distinct from
               (${row.label}, ${row.title}, ${row.signed_date}::date, ${row.governor})
        returning 1`;
      written += changed.length;
      continue;
    }
    // A short summary from the PDF, not its text: that stays on portal.ct.gov.
    const pdf = new Uint8Array(await (await http.get(order.url, 'application/pdf')).arrayBuffer());
    const detail = ctOrderSummary(pdfText(pdf));
    read++;
    await sql`
      insert into public.state_executive_orders ${sql({ ...row, ...detail })}
      on conflict (state, number) do update set
        label = excluded.label, title = excluded.title, url = excluded.url, signed_date = excluded.signed_date,
        governor = excluded.governor, summary = excluded.summary, reason = excluded.reason`;
    written++;
    log(`No. ${order.label} ${order.signed_date ?? 'no date'} ${detail.summary ? 'summary' : 'no text'}`);
  }
  log(JSON.stringify({ listed: items.length, orders: orders.length, pdfs: read, written }));
  return written;
}
