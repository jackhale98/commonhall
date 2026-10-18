import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { maBallotIndex, maBallotQuestionUrl } from '@civic/congress-client';
import { loadMaBallot } from '@civic/sync/loaders';
import type { Sql } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
const YEAR = 2026;
const ELECTION = '2026-11-03';

const clean = () => sql`delete from public.ballot_questions where state = 'MA' and election_date = ${ELECTION}`;
beforeEach(clean);
afterAll(async () => {
  await clean();
  await sql.end();
});

const fixture = (name: string) =>
  readFileSync(new URL(`../../packages/congress-client/test/fixtures/ma-ballot/${name}`, import.meta.url), 'utf8');
/** The recorded guide lists nine questions; only the first two are served here, so it says two. */
const index = () =>
  fixture('index.html').replace('each of the nine statewide questions', 'each of the two statewide questions');

/** sec.state.ma.us as the browser reads it; `pages` overrides a URL (null for a 404). */
function fakeGuide(pages: Record<string, string | null> = {}) {
  const opened: string[] = [];
  const served: Record<string, string | null> = {
    [maBallotIndex(YEAR)]: index(),
    [maBallotQuestionUrl(YEAR, 1)]: fixture('question1.html'),
    [maBallotQuestionUrl(YEAR, 2)]: fixture('question2.html'),
    ...pages,
  };
  const open = async (url: string) => {
    opened.push(url);
    return served[url] ?? null;
  };
  return { open, opened };
}

const load = (open: (url: string) => Promise<string | null>, year = YEAR) =>
  loadMaBallot(sql, { open, year, pauseMs: 0 });

const rows = () =>
  sql<{ number: number; kind: string; title: string; source_url: string }[]>`
    select number, kind, title, source_url from public.ballot_questions
     where state = 'MA' and election_date = ${ELECTION} order by number`;

describe('Load MA ballot questions', () => {
  it("loads the guide's questions, removes ones beyond its count, and writes nothing on a rerun", async () => {
    expect(index()).not.toBe(fixture('index.html'));
    // A question the guide no longer has.
    await sql`
      insert into public.ballot_questions (state, election_date, number, kind, title, source_url)
      values ('MA', ${ELECTION}, 5, 'Law Proposed by Initiative Petition', 'Withdrawn', 'https://www.sec.state.ma.us/')`;
    const guide = fakeGuide();
    expect(await load(guide.open)).toBe(3);
    expect(guide.opened).toEqual([maBallotIndex(YEAR), maBallotQuestionUrl(YEAR, 1), maBallotQuestionUrl(YEAR, 2)]);
    const loaded = await rows();
    expect(loaded.map((r) => r.number)).toEqual([1, 2]);
    expect(loaded[0]).toMatchObject({
      kind: 'Law Proposed by Initiative Petition',
      title: 'Expanding the Public Records Law',
      source_url: maBallotQuestionUrl(YEAR, 1),
    });
    const [q1] = await sql<{ argument_for: { authors: string[] }; notes: Record<string, string> }[]>`
      select argument_for, notes from public.ballot_questions
       where state = 'MA' and election_date = ${ELECTION} and number = 1`;
    expect(q1!.argument_for.authors).toContain('Diana DiZoglio');
    expect(q1!.notes.summary).toMatch(/^As required by law/);

    expect(await load(fakeGuide().open)).toBe(0);
  });

  it('writes nothing in an odd year or before the guide is published', async () => {
    const odd = fakeGuide();
    expect(await load(odd.open, 2027)).toBe(0);
    expect(odd.opened).toHaveLength(0);
    const unpublished = fakeGuide({ [maBallotIndex(YEAR)]: null });
    expect(await load(unpublished.open)).toBe(0);
    expect(unpublished.opened).toEqual([maBallotIndex(YEAR)]);
    expect(await rows()).toHaveLength(0);
  });

  it('fails on a changed or missing page', async () => {
    const withPage = (pages: Record<string, string | null>) => load(fakeGuide(pages).open);
    await expect(withPage({ [maBallotIndex(YEAR)]: '<p>Nothing here</p>' })).rejects.toThrow(
      /could not read how many questions/,
    );
    await expect(withPage({ [maBallotQuestionUrl(YEAR, 2)]: '<h1>Page not found</h1>' })).rejects.toThrow(
      /no "Question N" heading/,
    );
    await expect(withPage({ [maBallotQuestionUrl(YEAR, 2)]: null })).rejects.toThrow(/Question 2 of 2: .* not found/);
    await expect(withPage({ [maBallotQuestionUrl(YEAR, 2)]: fixture('question6.html') })).rejects.toThrow(
      /is question 6, expected 2/,
    );
  });
});
