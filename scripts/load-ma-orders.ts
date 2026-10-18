/**
 * Load Massachusetts governors' executive orders (packages/sync/src/loaders/ma-orders.ts).
 * mass.gov turns away plain requests, so the pages are read in a headless browser
 * (Playwright's Chromium). The "Load governor orders" workflow runs this weekly and
 * on demand.
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-ma-orders.ts [--ranges 2] [--executable /path/to/chromium]
 */
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';
import { loadMaOrders, type MaOrdersSite } from '@civic/sync/loaders';
import { connectDb } from './lib/db.ts';
import { recordRun } from './lib/record-run.ts';

/** mass.gov read in one browser page: each page's main content, an order page every 800 ms or so. */
function massGov(page: Page): MaOrdersSite {
  const open = async (href: string) => {
    const res = await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!res || !res.ok()) throw new Error(`${href}: ${res?.status() ?? 'no response'}`);
    // Pages arrive after a short browser check; wait for the article.
    await page.waitForSelector('main', { timeout: 30_000 });
  };
  return {
    async links(url) {
      await open(url);
      return page.$$eval('main a', (a) =>
        a.map((x) => ({ text: (x.textContent ?? '').trim(), href: (x as HTMLAnchorElement).href })),
      );
    },
    async text(url) {
      await open(url);
      const text = await page.$eval('main', (m) => (m as HTMLElement).innerText);
      await page.waitForTimeout(800);
      return text;
    },
  };
}

async function main() {
  const { values } = parseArgs({
    options: { ranges: { type: 'string', default: '2' }, executable: { type: 'string' } },
  });
  const sql = connectDb();
  const browser = await chromium.launch(values.executable ? { executablePath: values.executable } : {});
  try {
    const site = massGov(await browser.newPage());
    await recordRun(sql, 'load-ma-orders', 30, () =>
      loadMaOrders(sql, { site, ranges: Number(values.ranges), log: console.log }),
    );
  } finally {
    await browser.close();
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
