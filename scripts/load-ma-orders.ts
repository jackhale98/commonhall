/**
 * Load Massachusetts governors' executive orders into `state_executive_orders`
 * from the Trial Court Law Libraries' list on mass.gov. mass.gov turns away plain
 * requests, so the pages are read in a headless browser (Playwright's Chromium).
 * Reads the newest two index pages (orders 500 and up, about fifteen years), and
 * opens an order's own page only when it is new or has no date yet. The "Load
 * governor orders" workflow runs this weekly and on demand.
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-ma-orders.ts [--ranges 2] [--executable /path/to/chromium]
 */
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { chromium, type Page } from 'playwright';
import {
  MA_ORDERS_INDEX,
  maOrderRangePages,
  parseMaOrderDetail,
  parseMaOrderLinks,
  type MaOrderLink,
} from '@civic/congress-client';

const STATE = 'MA';
const MIN_ORDERS = 20;

const links = (page: Page) =>
  page.$$eval('main a', (a) =>
    a.map((x) => ({ text: (x.textContent ?? '').trim(), href: (x as HTMLAnchorElement).href })),
  );

async function main() {
  const { values } = parseArgs({
    options: { ranges: { type: 'string', default: '2' }, executable: { type: 'string' } },
  });
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Set SUPABASE_DB_URL');
  const sql = postgres(url, { max: 2, prepare: false, onnotice: () => undefined });
  const browser = await chromium.launch(values.executable ? { executablePath: values.executable } : {});
  try {
    const page = await browser.newPage();
    const open = async (href: string) => {
      const res = await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      if (!res || !res.ok()) throw new Error(`${href}: ${res?.status() ?? 'no response'}`);
      // Pages arrive after a short browser check; wait for the article.
      await page.waitForSelector('main', { timeout: 30_000 });
    };

    await open(MA_ORDERS_INDEX);
    const ranges = maOrderRangePages(await links(page)).slice(0, Number(values.ranges));
    const orders: MaOrderLink[] = [];
    for (const range of ranges) {
      await open(range);
      orders.push(...parseMaOrderLinks(await links(page)));
    }
    // A changed layout reads as few or no orders: fail loudly rather than load nothing.
    if (orders.length < MIN_ORDERS)
      throw new Error(`Read only ${orders.length} orders; has mass.gov's layout changed?`);

    const known = new Map(
      (
        await sql<{ number: number; signed_date: string | null }[]>`
          select number, signed_date::text from public.state_executive_orders where state = ${STATE}`
      ).map((r) => [r.number, r.signed_date]),
    );
    let written = 0;
    for (const order of orders) {
      const row = { state: STATE, number: order.number, title: order.title, url: order.url };
      if (known.has(order.number) && known.get(order.number)) {
        // Titles are corrected now and then; dates and issuers don't change.
        const changed = await sql`
          update public.state_executive_orders set title = ${row.title}, url = ${row.url}
           where state = ${STATE} and number = ${row.number} and (title <> ${row.title} or url <> ${row.url})
          returning 1`;
        written += changed.length;
        continue;
      }
      await open(order.url);
      const detail = parseMaOrderDetail(await page.$eval('main', (m) => (m as HTMLElement).innerText));
      await sql`
        insert into public.state_executive_orders ${sql({ ...row, ...detail })}
        on conflict (state, number) do update set
          title = excluded.title, url = excluded.url, signed_date = excluded.signed_date,
          governor = excluded.governor, revokes = excluded.revokes`;
      written++;
      console.log(`No. ${order.number}`, detail.signed_date ?? 'no date', detail.governor ?? '');
      await page.waitForTimeout(800);
    }
    console.log(JSON.stringify({ orders: orders.length, written }));
  } finally {
    await browser.close();
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
