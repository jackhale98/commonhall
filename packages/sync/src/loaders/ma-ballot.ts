/**
 * Massachusetts' statewide ballot questions into `ballot_questions`, from the
 * Secretary of the Commonwealth's "Information for Voters" guide for a year's state
 * election (even years). The guide's site turns away plain requests and headless
 * browsers that say so, so the script reads the pages in a browser (retrying when it
 * is turned away) and hands this loader each page's HTML. Before the guide is
 * published (or in an odd year) there is nothing to load and the run succeeds with
 * nothing written. Run by scripts/load-ma-ballot.ts ("Load MA ballot questions").
 */
import type postgres from 'postgres';
import {
  electionDay,
  maBallotIndex,
  maBallotQuestionCount,
  maBallotQuestionUrl,
  parseMaBallotQuestion,
} from '@civic/congress-client';
import type { Sql } from '../db.ts';

const STATE = 'MA';
/** Plain data as postgres.js's JSON type. */
const json = (value: unknown) => value as postgres.JSONValue;

/** A page's HTML, or null when it is not there (404). Throws when the page cannot be read. */
export type OpenPage = (url: string) => Promise<string | null>;

export interface MaBallotOptions {
  open: OpenPage;
  year: number;
  /** The pause before each question page, so the site's browser check lets them through. */
  pauseMs?: number;
  log?: (message: string) => void;
}

/** Load the year's questions, rewriting only those that changed; returns the rows written or removed. */
export async function loadMaBallot(sql: Sql, options: MaBallotOptions): Promise<number> {
  const { open, year, pauseMs = 5_000, log = () => undefined } = options;
  if (year % 2 === 1) {
    log(`No state election in ${year}.`);
    return 0;
  }
  const index = await open(maBallotIndex(year));
  if (!index) {
    log(`The ${year} guide is not published yet.`);
    return 0;
  }
  const count = maBallotQuestionCount(index);
  if (!count) throw new Error(`${year} guide: could not read how many questions there are; has the page changed?`);

  const election = electionDay(year);
  let written = 0;
  for (let n = 1; n <= count; n++) {
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
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
    log(`Question ${n}: ${q.title}${changed.length ? '' : ' (unchanged)'}`);
  }
  const removed = await sql`
    delete from public.ballot_questions where state = ${STATE} and election_date = ${election} and number > ${count}
    returning 1`;
  log(JSON.stringify({ year, questions: count, written, removed: removed.length }));
  return written + removed.length;
}
