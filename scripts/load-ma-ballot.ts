/**
 * Load Massachusetts' statewide ballot questions into `ballot_questions` from the
 * Secretary of the Commonwealth's "Information for Voters" guide for this year's
 * state election (even years). The guide's site turns away plain requests and
 * headless browsers that say so, so the pages are read in Chromium with a desktop
 * browser's user agent, a few seconds apart (with longer pauses when it turns one away). Before the guide is published (or in an
 * odd year) there is nothing to load and the run succeeds with nothing written. The
 * "Load MA ballot questions" workflow runs this weekly and on demand.
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-ma-ballot.ts [--year 2026] [--executable /path/to/chromium]
 */
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  electionDay,
  maBallotIndex,
  maBallotQuestionCount,
  maBallotQuestionUrl,
  parseMaBallotQuestion,
} from '@civic/congress-client';
import { recordRun } from './lib/record-run.ts';

const STATE = 'MA';
/** Plain data as postgres.js's JSON type. */
const json = (value: unknown) => value as postgres.JSONValue;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * A browser session for the guide. The site's browser check lets a few pages through
 * and then starts turning requests away for a while, so a blocked page is retried
 * in a fresh session after a pause of a minute or more.
 */
function guide(browser: Browser) {
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  return async function open(url: string): Promise<string | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!page) {
        context = await browser.newContext({ userAgent: USER_AGENT });
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
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Set SUPABASE_DB_URL');
  const sql = postgres(url, { max: 2, prepare: false, onnotice: () => undefined });
  const browser = await chromium.launch(values.executable ? { executablePath: values.executable } : {});
  try {
    const open = guide(browser);
    await recordRun(sql, 'load-ma-ballot', 85, async () => {
      if (year % 2 === 1) {
        console.log(`No state election in ${year}.`);
        return 0;
      }
      const index = await open(maBallotIndex(year));
      if (!index) {
        console.log(`The ${year} guide is not published yet.`);
        return 0;
      }
      const count = maBallotQuestionCount(index);
      if (!count) throw new Error(`${year} guide: could not read how many questions there are; has the page changed?`);

      const election = electionDay(year);
      let written = 0;
      for (let n = 1; n <= count; n++) {
        await new Promise((r) => setTimeout(r, 5_000));
        const source = maBallotQuestionUrl(year, n);
        const html = await open(source);
        if (!html) throw new Error(`Question ${n} of ${count}: ${source} not found`);
        const q = parseMaBallotQuestion(html);
        if (q.number !== n) throw new Error(`${source} is question ${q.number}, expected ${n}`);
        const row = {
          state: STATE,
          election_date: election,
          number: q.number,
          kind: q.kind,
          title: q.title,
          question: q.question,
          summary: q.summary,
          yes_vote: q.yesVote,
          no_vote: q.noVote,
          fiscal: q.fiscal,
          argument_for: q.argumentFor ? sql.json(json(q.argumentFor)) : null,
          argument_against: q.argumentAgainst ? sql.json(json(q.argumentAgainst)) : null,
          reports: sql.json(json(q.reports)),
          full_text: q.fullText,
          notes: sql.json(q.notes),
          source_url: source,
        };
        // Rewrite only what changed (the guide is corrected now and then before Election Day).
        const changed = await sql`
          insert into public.ballot_questions ${sql(row)}
          on conflict (state, election_date, number) do update set
            kind = excluded.kind, title = excluded.title, question = excluded.question,
            summary = excluded.summary, yes_vote = excluded.yes_vote, no_vote = excluded.no_vote,
            fiscal = excluded.fiscal, argument_for = excluded.argument_for,
            argument_against = excluded.argument_against, reports = excluded.reports,
            full_text = excluded.full_text, notes = excluded.notes, source_url = excluded.source_url,
            updated_at = now()
          where (ballot_questions.kind, ballot_questions.title, ballot_questions.question, ballot_questions.summary,
                 ballot_questions.yes_vote, ballot_questions.no_vote, ballot_questions.fiscal,
                 ballot_questions.argument_for, ballot_questions.argument_against, ballot_questions.reports,
                 ballot_questions.full_text, ballot_questions.notes, ballot_questions.source_url)
            is distinct from
                (excluded.kind, excluded.title, excluded.question, excluded.summary, excluded.yes_vote,
                 excluded.no_vote, excluded.fiscal, excluded.argument_for, excluded.argument_against,
                 excluded.reports, excluded.full_text, excluded.notes, excluded.source_url)
          returning 1`;
        written += changed.length;
        console.log(`Question ${n}: ${q.title}${changed.length ? '' : ' (unchanged)'}`);
      }
      const removed = await sql`
        delete from public.ballot_questions where state = ${STATE} and election_date = ${election} and number > ${count}
        returning 1`;
      console.log(JSON.stringify({ year, questions: count, written, removed: removed.length }));
      return written + removed.length;
    });
  } finally {
    await browser.close();
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
