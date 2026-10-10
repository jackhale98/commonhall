/**
 * Load Connecticut governors' executive orders into `state_executive_orders` from
 * the Governor's office list on portal.ct.gov (plain requests work). Reads the whole
 * list (about five pages of 50) and keeps the governor's own orders (Lamont's, about
 * 140; earlier governors' numbers repeat his). The list gives each order's date and a
 * one-line description, used as its title. An order's PDF is read only when the order
 * is new or its file changed, for a short summary of what it orders and why (none when
 * the PDF is a scan). The "Load CT governor orders" workflow runs this weekly and on
 * demand. Needs `pdftotext` (poppler-utils).
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-ct-orders.ts [--refresh]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import {
  HttpClient,
  checkKept,
  ctOrderSummary,
  ctOrders,
  ctOrdersPageUrl,
  parseCtOrderList,
  type CtOrderListItem,
} from '@civic/congress-client';
import { recordRun } from './lib/record-run.ts';

const STATE = 'CT';
const PAGE_SIZE = 50;
/** Governor Lamont alone has issued about 140: far fewer means the page has changed. */
const MIN_ORDERS = 100;

function pdfText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'ct-order-'));
  try {
    const file = join(dir, 'order.pdf');
    writeFileSync(file, pdf);
    return execFileSync('pdftotext', [file, '-'], { maxBuffer: 16 * 1024 * 1024 }).toString('utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: { refresh: { type: 'boolean', default: false } } });
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Set SUPABASE_DB_URL');
  const sql = postgres(url, { max: 2, prepare: false, onnotice: () => undefined });
  const http = new HttpClient({ minIntervalMs: 500, maxAttempts: 3 });
  try {
    await recordRun(sql, 'load-ct-orders', 20, async () => {
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
      for (const s of skipped) console.log('Not an order number:', s.heading, s.url);
      checkKept('portal.ct.gov executive orders', orders.length + skipped.length, orders.length);
      // A changed layout reads as few or no orders: fail loudly rather than load nothing.
      if (orders.length < MIN_ORDERS)
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
        ).map((r) => [r.number, r.url]),
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
        if (!values.refresh && known.get(order.number) === order.url) {
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
        const pdf = Buffer.from(await (await http.get(order.url, 'application/pdf')).arrayBuffer());
        const detail = ctOrderSummary(pdfText(pdf));
        read++;
        await sql`
          insert into public.state_executive_orders ${sql({ ...row, ...detail })}
          on conflict (state, number) do update set
            label = excluded.label, title = excluded.title, url = excluded.url, signed_date = excluded.signed_date,
            governor = excluded.governor, summary = excluded.summary, reason = excluded.reason`;
        written++;
        console.log(`No. ${order.label}`, order.signed_date ?? 'no date', detail.summary ? 'summary' : 'no text');
      }
      console.log(JSON.stringify({ listed: items.length, orders: orders.length, pdfs: read, written }));
      return written;
    });
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
