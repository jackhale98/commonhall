/**
 * Bristol, Connecticut: the City Council and its committees from CivicClerk
 * (hourly), and the mayor and councilors from the city's website (weekly).
 *
 *  - Bodies: the City Council (regular and special meetings), its joint meetings
 *    with the Board of Finance, and the council's Ordinance, Real Estate and Salary
 *    Committees. CivicClerk lists about sixty boards; the rest are left out. The
 *    bodies are found by name in the category list, so a renamed one fails the job.
 *  - Meetings: the first run reads from January of last year; later runs read the
 *    last four months and everything scheduled.
 *  - Agenda items: each numbered item ("2026-2402") is a council matter
 *    (`ct-bristol-202602402`), with an action for each meeting it is on, like
 *    Worcester's agenda items (§87). Procedure (call to order, minutes, public
 *    participation, announcements, adjournment) is left out. An agenda is read once,
 *    and again while its meeting is within two weeks (agendas get revised).
 *    CivicClerk has vote fields, but Bristol leaves them empty: outcomes are in the
 *    minutes PDFs, which we link and don't read.
 *  - Councilors: replaced only when the page reads as complete (six councilors and
 *    the mayor), so a changed layout fails loudly instead of emptying the city.
 */
import {
  BRISTOL_COUNCIL_URL,
  HttpClient,
  civicClerkLocal,
  civicClerkText,
  parseBristolCouncil,
  type CityCouncilor,
  type CivicClerkClient,
  type CivicClerkEvent,
  type CivicClerkItem,
} from '@civic/congress-client';
import { upsertIfChanged, type Sql } from '../db.ts';
import type { JobRun } from '../job.ts';
import { meetingStart } from './boston.ts';

export const BRISTOL_JOB = 'bristol';
export const BRISTOL = 'ct-bristol';
const MIN_COUNCILORS = 7;
/** Agendas this recent are read again each run. */
const REVISABLE_DAYS = 14;
/** Later runs list meetings from this many days back. */
const LOOKBACK_DAYS = 120;

/** The CivicClerk categories we keep, by name, and the committee each one is (null: the full council). */
export const BRISTOL_BODIES: { category: string; committee: string | null }[] = [
  { category: 'City Council', committee: null },
  { category: 'Joint Meeting of the City Council and Board of Finance', committee: null },
  { category: 'Ordinance Committee', committee: 'Ordinance Committee' },
  { category: 'Real Estate Committee', committee: 'Real Estate Committee' },
  { category: 'Salary Committee', committee: 'Salary Committee' },
];

export interface BristolCursor extends Record<string, unknown> {
  peopleAt?: string;
  backfilled?: boolean;
  /** Agendas read: event id → agenda id. */
  read?: Record<string, number>;
}

export interface SyncBristolOptions {
  civicclerk: CivicClerkClient;
  /** Fetches a page of the city's website as text. */
  fetchPage: (url: string) => Promise<string>;
  now?: () => Date;
}

const DAY_MS = 86_400_000;
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Store a city's councilors from its website and retire the ones no longer listed. Returns rows written. */
export async function storeCouncilors(sql: Sql, city: string, councilors: CityCouncilor[]): Promise<number> {
  let written = 0;
  await sql.begin(async (tx) => {
    for (const c of councilors)
      if (
        await upsertIfChanged(tx, 'public.local_officials', ['id'], {
          id: c.id,
          city,
          person_id: null,
          name: c.name,
          seat: c.seat,
          district: c.district,
          title: c.title,
          email: c.email,
          photo_url: c.photo_url,
          current: true,
        })
      )
        written += 1;
    const retired = await tx`
      update public.local_officials set current = false
       where city = ${city} and current and id <> all(${councilors.map((c) => c.id)}::text[]) returning 1`;
    written += retired.length;
  });
  return written;
}

/** "2026-2402" → 202602402: the matter number within the city (year × 100,000 + number). */
export function bristolMatterNumber(itemNumber: string): number | null {
  const m = /^(\d{4})-(\d{1,5})$/.exec(itemNumber.trim());
  return m ? Number(m[1]) * 100_000 + Number(m[2]) : null;
}

/** Sections whose items are procedure, not business. */
const PROCEDURE =
  /^(call to order|pledge|roll call|approval of (the )?minutes|minutes|public participation|public comment|announcements|adjourn)/i;

/** What kind of matter an item is, from its wording, then its section. */
export function bristolItemType(text: string, section: string): string {
  if (/\bordinances?\b/i.test(text) && /\b(adopt|introduce|amend|repeal|enact)/i.test(text)) return 'Ordinance';
  if (/^(to adopt (the following |a )?)?resolution\b/i.test(text)) return 'Resolution';
  const s = section.toLowerCase();
  if (/consent/.test(s)) return 'Consent agenda';
  if (/report/.test(s)) return 'Committee report';
  if (/appoint|resignation/.test(s)) return 'Appointment';
  if (/contract|bid/.test(s)) return 'Contract';
  if (/referral/.test(s)) return 'Referral';
  if (/executive session/.test(s)) return 'Executive session';
  if (/public hearing/.test(s)) return 'Public hearing';
  if (/transfer|budget|appropriation/.test(s)) return 'Budget';
  return 'Business';
}

export interface BristolItem {
  number: string;
  matterNumber: number;
  /** "5a". */
  outline: string;
  section: string;
  text: string;
  type: string;
}

/** The numbered items of an agenda, procedure left out, in agenda order. */
export function bristolAgendaItems(items: CivicClerkItem[]): BristolItem[] {
  const out: BristolItem[] = [];
  const visit = (item: CivicClerkItem, section: string, sectionOutline: string) => {
    const name = civicClerkText(item.agendaObjectItemName ?? '');
    const outline = (item.agendaObjectItemOutlineNumber ?? '').replace(/\.$/, '');
    const matterNumber = bristolMatterNumber(item.agendaObjectItemNumber ?? '');
    if (matterNumber !== null && name && !PROCEDURE.test(section) && !PROCEDURE.test(name))
      out.push({
        number: item.agendaObjectItemNumber.trim(),
        matterNumber,
        outline: `${sectionOutline}${outline}`,
        section,
        text: name,
        type: bristolItemType(name, section),
      });
    for (const child of item.childItems ?? [])
      visit(child, item.isSection ? name : section, item.isSection ? outline : sectionOutline);
  };
  for (const item of items) visit(item, '', '');
  return out;
}

export function bristolMeetingRow(e: CivicClerkEvent, civicclerk: CivicClerkClient, committee: string | null) {
  const { date, time } = civicClerkLocal(e.startDateTime);
  const file = (re: RegExp) => e.publishedFiles.find((f) => re.test(f.type.trim()));
  const agenda = file(/^agenda$/i);
  const minutes = file(/^minutes$/i);
  const place = [e.eventLocation?.address1, e.eventLocation?.address2].map((s) => s?.trim()).filter(Boolean);
  return {
    id: `${BRISTOL}-m${e.id}`,
    city: BRISTOL,
    event_id: e.id,
    body: e.categoryName,
    starts_at: meetingStart(date, time),
    date,
    time,
    location: place.length ? place.join(', ') : null,
    agenda_url: agenda ? civicclerk.fileUrl(agenda.fileId) : null,
    minutes_url: minutes ? civicclerk.fileUrl(minutes.fileId) : null,
    legistar_url: civicclerk.eventUrl(e.id),
    status: /cancell?ed/i.test(e.eventName) ? 'Cancelled' : null,
    committees: committee ? [committee] : [],
  };
}

/** Write one agenda's items: they replace the meeting's earlier ones, and each is a matter with an action here. */
export async function writeBristolAgenda(
  sql: Sql,
  e: CivicClerkEvent,
  items: BristolItem[],
  civicclerk: CivicClerkClient,
): Promise<number> {
  const { date } = civicClerkLocal(e.startDateTime);
  const meetingId = `${BRISTOL}-m${e.id}`;
  const body = e.categoryName;
  const unique = [...new Map(items.map((i) => [i.matterNumber, i])).values()];
  const matters = unique.map((i) => ({
    id: `${BRISTOL}-${i.matterNumber}`,
    city: BRISTOL,
    matter_id: i.matterNumber,
    file_number: i.number,
    title: i.text,
    type: i.type,
    status: null,
    body,
    intro_date: date,
    agenda_date: date,
    passed_date: null,
    legistar_url: civicclerk.eventUrl(e.id),
    last_modified: `${date}T12:00:00Z`,
    latest_action_date: date,
    latest_action_text: `On the ${body} agenda${i.section ? `: ${i.section}` : ''}`,
  }));
  const rows = unique.map((i, n) => ({
    meeting_id: meetingId,
    seq: n + 1,
    matter_id: `${BRISTOL}-${i.matterNumber}`,
    file_number: i.number,
    title: i.text,
  }));
  const actions = unique.map((i) => ({
    matter_id: `${BRISTOL}-${i.matterNumber}`,
    seq: e.id,
    action_date: date,
    action_name: 'On the agenda',
    action_text: `Item ${i.outline} on the ${body} agenda (${shortDate(date)})${i.section ? `, ${i.section}` : ''}`,
    body,
    passed: null,
    event_id: e.id,
  }));
  await sql.begin(async (tx) => {
    await tx`delete from public.local_meeting_items where meeting_id = ${meetingId}`;
    await tx`delete from public.local_matter_actions where event_id = ${e.id} and matter_id like ${`${BRISTOL}-%`}`;
    if (matters.length === 0) return;
    // An item on several agendas keeps one matter: its latest wording, first and latest dates.
    await tx`
      insert into public.local_matters ${tx(matters)}
      on conflict (id) do update set
        title = case when excluded.agenda_date >= local_matters.agenda_date then excluded.title else local_matters.title end,
        type = case when excluded.agenda_date >= local_matters.agenda_date then excluded.type else local_matters.type end,
        body = case when excluded.agenda_date >= local_matters.agenda_date then excluded.body else local_matters.body end,
        legistar_url = case when excluded.agenda_date >= local_matters.agenda_date then excluded.legistar_url else local_matters.legistar_url end,
        latest_action_text = case when excluded.agenda_date >= local_matters.agenda_date
          then excluded.latest_action_text else local_matters.latest_action_text end,
        intro_date = least(local_matters.intro_date, excluded.intro_date),
        agenda_date = greatest(local_matters.agenda_date, excluded.agenda_date),
        latest_action_date = greatest(local_matters.latest_action_date, excluded.latest_action_date),
        last_modified = greatest(local_matters.last_modified, excluded.last_modified)`;
    await tx`insert into public.local_meeting_items ${tx(rows)}`;
    await tx`
      insert into public.local_matter_actions ${tx(actions)}
      on conflict (matter_id, seq) do update set
        action_date = excluded.action_date, action_text = excluded.action_text, body = excluded.body`;
  });
  return rows.length;
}

async function syncPeople(sql: Sql, options: SyncBristolOptions, log: JobRun['log']): Promise<number> {
  const councilors = parseBristolCouncil(await options.fetchPage(BRISTOL_COUNCIL_URL));
  if (councilors.length < MIN_COUNCILORS || !councilors.some((c) => c.title === 'Mayor'))
    throw new Error(`Bristol council page read as ${councilors.length} members; has its layout changed?`);
  let written = await storeCouncilors(sql, BRISTOL, councilors);
  const committees = BRISTOL_BODIES.flatMap((b) => (b.committee ? [b.committee] : []));
  await sql.begin(async (tx) => {
    for (const name of committees) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      if (
        await upsertIfChanged(tx, 'public.local_committees', ['id'], {
          id: `${BRISTOL}-${slug}`,
          city: BRISTOL,
          slug,
          name,
          description: null,
          url: options.civicclerk.portalUrl,
        })
      )
        written += 1;
    }
  });
  log('people', { councilors: councilors.length, written });
  return written;
}

export async function syncBristol(run: JobRun<BristolCursor>, options: SyncBristolOptions): Promise<BristolCursor> {
  const now = options.now ?? (() => new Date());
  const cursor: BristolCursor = { ...run.cursor };

  if (!cursor.peopleAt || new Date(cursor.peopleAt).getTime() < now().getTime() - 7 * DAY_MS) {
    run.rowsWritten += await syncPeople(run.sql, options, run.log);
    cursor.peopleAt = now().toISOString();
    await run.checkpoint(cursor);
  }

  const categories = await options.civicclerk.categories();
  const bodies = BRISTOL_BODIES.map((b) => {
    const hit = categories.find((c) => c.categoryDesc.trim().toLowerCase() === b.category.toLowerCase());
    return { ...b, id: hit?.id };
  });
  const missing = bodies.filter((b) => b.id === undefined).map((b) => b.category);
  if (missing.includes('City Council'))
    throw new Error('CivicClerk has no "City Council" category; have the boards been renamed?');
  if (missing.length) run.log('CivicClerk categories not found', { missing });
  const committeeOf = new Map(bodies.filter((b) => b.id !== undefined).map((b) => [b.id!, b.committee]));

  const year = now().getUTCFullYear();
  const since = cursor.backfilled
    ? new Date(now().getTime() - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10)
    : `${year - 1}-01-01`;
  const events = (await options.civicclerk.events({ categories: [...committeeOf.keys()], since })).filter((e) =>
    committeeOf.has(e.categoryId),
  );

  let written = 0;
  for (const e of events) {
    const row = bristolMeetingRow(e, options.civicclerk, committeeOf.get(e.categoryId) ?? null);
    if (await upsertIfChanged(run.sql, 'public.local_meetings', ['id'], row)) written += 1;
  }
  run.rowsWritten += written;

  // Agendas: unread ones (oldest first, so a carried item's first date is right) and recent ones again.
  const read = { ...(cursor.read ?? {}) };
  const revisable = new Date(now().getTime() - REVISABLE_DAYS * DAY_MS).toISOString().slice(0, 10);
  let agendas = 0;
  let items = 0;
  for (const e of events) {
    if (run.outOfTime()) break;
    if (e.agendaId <= 0) continue;
    const date = civicClerkLocal(e.startDateTime).date;
    if (read[String(e.id)] === e.agendaId && date < revisable) continue;
    const meeting = await options.civicclerk.meeting(e.agendaId);
    const list = bristolAgendaItems(meeting.items);
    items += await writeBristolAgenda(run.sql, e, list, options.civicclerk);
    read[String(e.id)] = e.agendaId;
    agendas += 1;
    if (agendas % 10 === 0) await run.checkpoint({ ...cursor, read });
  }
  // About a hundred meetings a year: small enough to keep every one read.
  cursor.read = read;
  // Later runs list only recent meetings, once every agenda of the first window has been read.
  if (!run.outOfTime()) cursor.backfilled = true;
  run.rowsWritten += items;
  await run.checkpoint(cursor);
  run.log('bristol', { meetings: events.length, written, agendas, items });
  return cursor;
}

/** Read a page of the city's website as text. */
export function bristolPageFetcher(http = new HttpClient({ maxAttempts: 3 })) {
  return (url: string) => http.getText(url, 'text/html');
}
