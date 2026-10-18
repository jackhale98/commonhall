/**
 * Load Massachusetts' statewide ballot questions (packages/sync/src/loaders/ma-ballot.ts).
 * The guide's site turns away plain requests and headless browsers that say so, so
 * the pages are read in Chromium with a desktop browser's user agent, a few seconds
 * apart (with longer pauses when it turns one away). The "Load MA ballot questions"
 * workflow runs this weekly and on demand.
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-ma-ballot.ts [--year 2026] [--executable /path/to/chromium]
 */
import { parseArgs } from 'node:util';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { DESKTOP_USER_AGENT } from '@civic/congress-client';
import { loadMaBallot, type OpenPage } from '@civic/sync/loaders';
import { connectDb } from './lib/db.ts';
import { recordRun } from './lib/record-run.ts';

/**
 * A browser session for the guide. The site's browser check lets a few pages through
 * and then starts turning requests away for a while, so a blocked page is retried
 * in a fresh session after a pause of a minute or more.
 */
function guide(browser: Browser): OpenPage {
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  return async function open(url: string): Promise<string | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!page) {
        context = await browser.newContext({ userAgent: DESKTOP_USER_AGENT });
        page = await context.newPage();
      }
      const res = await page.goto(url, { timeout: 90_000 }).catch(() => null);
      if (res?.status() === 404) return null;
      // The page arrives after a short browser check.
      await page.waitForTimeout(6_000);
      if (await page.$('#main-content')) return page.content();
      console.log(`Turned away (${url}); trying again shortly`);
      await context?.close();
      context = null;
      page = null;
      await new Promise((r) => setTimeout(r, 60_000 * (attempt + 1)));
    }
    throw new Error(`${url}: the site's browser check did not let the page through`);
  };
}

async function main() {
  const { values } = parseArgs({
    options: { year: { type: 'string' }, executable: { type: 'string' } },
  });
  const year = Number(values.year ?? new Date().getUTCFullYear());
  const sql = connectDb();
  const browser = await chromium.launch(values.executable ? { executablePath: values.executable } : {});
  try {
    const open = guide(browser);
    await recordRun(sql, 'load-ma-ballot', 85, () => loadMaBallot(sql, { open, year, log: console.log }));
  } finally {
    await browser.close();
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
