/**
 * Worcester City Council: councilors and standing committees from the city's
 * website (weekly), and council and committee meetings from PrimeGov (hourly).
 *
 *  - Councilors and committees are replaced only when the page reads as complete
 *    (nine or more councilors, five or more committees), so a changed layout can't
 *    empty the city; it fails loudly instead.
 *  - Meetings: the first run reads last year's and this year's archive; later
 *    runs read this year's archive and the upcoming list. Only City Council and
 *    standing committee meetings are kept (PrimeGov also lists boards, school
 *    councils and commissions).
 */
import {
  HttpClient,
  PrimeGovClient,
  WORCESTER_COMMITTEES_URL,
  WORCESTER_COUNCILORS_URL,
  matchCommittee,
  parseWorcesterCommittees,
  parseWorcesterCouncilors,
  worcesterMeetingKind,
  worcesterOfficialId,
  type PrimeGovMeeting,
  type WorcesterCommittee,
  type WorcesterCouncilor,
} from '@civic/congress-client';
import { upsertIfChanged, type Sql } from '../db.ts';
import type { JobRun } from '../job.ts';
import { meetingStart } from './boston.ts';

export const WORCESTER_JOB = 'worcester';
/** The city key (state and name); every Worcester id starts with it. */
export const WORCESTER = 'ma-worcester';
const MIN_COUNCILORS = 9;
const MIN_COMMITTEES = 5;

export interface WorcesterCursor extends Record<string, unknown> {
  peopleAt?: string;
  /** First run read last year's archive too. */
  backfilled?: boolean;
}

export interface SyncWorcesterOptions {
  primegov: PrimeGovClient;
  /** Fetches a page of the city's website as text. */
  fetchPage: (url: string) => Promise<string>;
  now?: () => Date;
}

export function worcesterOfficialRow(c: WorcesterCouncilor) {
  return {
    id: c.id,
    city: WORCESTER,
    person_id: null,
    name: c.name,
    seat: c.seat,
    district: c.district,
    title: c.title,
    email: c.email,
    photo_url: c.photo_url,
    current: true,
  };
}

/** One council or committee meeting as a local_meetings row, or null for other boards. */
export function worcesterMeetingRow(
  m: PrimeGovMeeting,
  primegov: PrimeGovClient,
  committees: Pick<WorcesterCommittee, 'name'>[] = [],
) {
  const kind = worcesterMeetingKind(m.title);
  if (kind.committees === null) return null;
  const doc = (re: RegExp) => m.documentList.find((d) => re.test(d.templateName.trim()));
  // Newer meetings publish a PDF "Agenda"; older ones only an "HTML Agenda" (or "HTM Minutes").
  const agenda = doc(/^agenda$/i) ?? doc(/^html? agenda$/i);
  const minutes = doc(/^minutes$/i) ?? doc(/^html? minutes$/i);
  const date = m.dateTime.slice(0, 10);
  return {
    id: `${WORCESTER}-m${m.id}`,
    city: WORCESTER,
    event_id: m.id,
    body: 'City Council',
    starts_at: meetingStart(date, m.time),
    date,
    time: m.time?.replace(/^0/, '') ?? null,
    location: m.location?.trim() || null,
    agenda_url: agenda ? primegov.documentUrl(agenda) : null,
    minutes_url: minutes ? primegov.documentUrl(minutes) : null,
    legistar_url: primegov.portalUrl,
    status: kind.cancelled ? 'Cancelled' : null,
    committees: kind.committees.map((name) => matchCommittee(name, committees)?.name ?? name),
  };
}

async function syncPeople(sql: Sql, options: SyncWorcesterOptions, log: JobRun['log']) {
  const [councilorsHtml, committeesHtml] = await Promise.all([
    options.fetchPage(WORCESTER_COUNCILORS_URL),
    options.fetchPage(WORCESTER_COMMITTEES_URL),
  ]);
  const councilors = parseWorcesterCouncilors(councilorsHtml);
  const committees = parseWorcesterCommittees(committeesHtml);
  if (councilors.length < MIN_COUNCILORS)
    throw new Error(`Worcester councilors page read as ${councilors.length} councilors; has its layout changed?`);
  if (committees.length < MIN_COMMITTEES)
    throw new Error(`Worcester committees page read as ${committees.length} committees; has its layout changed?`);

  const ids = new Set(councilors.map((c) => c.id));
  let written = 0;
  await sql.begin(async (tx) => {
    for (const c of councilors)
      if (await upsertIfChanged(tx, 'public.local_officials', ['id'], worcesterOfficialRow(c))) written += 1;
    const retired = await tx`
      update public.local_officials set current = false
       where city = ${WORCESTER} and current and id <> all(${[...ids]}::text[]) returning 1`;
    written += retired.length;

    const keep = committees.map((c) => `${WORCESTER}-${c.slug}`);
    await tx`delete from public.local_committees where city = ${WORCESTER} and id <> all(${keep}::text[])`;
    for (const c of committees) {
      const id = `${WORCESTER}-${c.slug}`;
      if (
        await upsertIfChanged(tx, 'public.local_committees', ['id'], {
          id,
          city: WORCESTER,
          slug: c.slug,
          name: c.name,
          description: c.description,
          url: WORCESTER_COMMITTEES_URL,
        })
      )
        written += 1;
      const members = c.members.map((m, i) => {
        const official = worcesterOfficialId(m.name);
        return {
          committee_id: id,
          seq: i + 1,
          official_id: ids.has(official) ? official : null,
          name: m.name,
          role: m.role,
        };
      });
      const before = await tx<{ name: string; role: string | null; official_id: string | null }[]>`
        select name, role, official_id from public.local_committee_members where committee_id = ${id} order by seq`;
      const same =
        before.length === members.length &&
        members.every(
          (m, i) =>
            m.name === before[i]!.name && m.role === before[i]!.role && m.official_id === before[i]!.official_id,
        );
      if (!same) {
        await tx`delete from public.local_committee_members where committee_id = ${id}`;
        await tx`insert into public.local_committee_members ${tx(members as never)}`;
        written += members.length;
      }
    }
  });
  const unmatched = committees.flatMap((c) => c.members).filter((m) => !ids.has(worcesterOfficialId(m.name)));
  if (unmatched.length) log('committee members not on the councilors page', { names: unmatched.map((m) => m.name) });
  return { written, committees };
}

export async function syncWorcester(
  run: JobRun<WorcesterCursor>,
  options: SyncWorcesterOptions,
): Promise<WorcesterCursor> {
  const now = options.now ?? (() => new Date());
  const cursor: WorcesterCursor = { ...run.cursor };

  const weekAgo = now().getTime() - 7 * 86_400_000;
  if (!cursor.peopleAt || new Date(cursor.peopleAt).getTime() < weekAgo) {
    const { written } = await syncPeople(run.sql, options, run.log);
    run.rowsWritten += written;
    cursor.peopleAt = now().toISOString();
    await run.checkpoint(cursor);
  }

  const committees = await run.sql<{ name: string }[]>`
    select name from public.local_committees where city = ${WORCESTER}`;
  const year = now().getUTCFullYear();
  const lists = await Promise.all([
    ...(cursor.backfilled ? [] : [options.primegov.archived(year - 1)]),
    options.primegov.archived(year),
    options.primegov.upcoming(),
  ]);
  const rows = [
    ...new Map(
      lists
        .flat()
        .map((m) => worcesterMeetingRow(m, options.primegov, committees))
        .filter((r) => r !== null)
        .map((r) => [r.id, r]),
    ).values(),
  ];
  // Meetings of other bodies (the School Committee, boards) are left out by title. If
  // none is recognized, PrimeGov's titles have changed: fail rather than look quiet.
  const listed = lists.flat();
  const skipped = [
    ...new Set(listed.filter((m) => worcesterMeetingKind(m.title).committees === null).map((m) => m.title)),
  ];
  if (skipped.length) run.log('meetings not recognized as council meetings', { titles: skipped.slice(0, 15) });
  if (listed.length >= 20 && rows.length === 0)
    throw new Error(`None of ${listed.length} PrimeGov meetings is a council meeting; have the titles changed?`);
  let written = 0;
  for (const row of rows) if (await upsertIfChanged(run.sql, 'public.local_meetings', ['id'], row)) written += 1;
  run.rowsWritten += written;
  cursor.backfilled = true;
  await run.checkpoint(cursor);
  run.log('meetings', { listed: rows.length, written });
  return cursor;
}

/** Read a page of the city's website as text. */
export function worcesterPageFetcher(http = new HttpClient({ maxAttempts: 3 })) {
  return (url: string) => http.getText(url, 'text/html');
}
