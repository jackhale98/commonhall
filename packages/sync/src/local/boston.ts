/**
 * Boston City Council sync from Legistar (every 15 minutes; quiet runs cost two list requests).
 *
 *  - Councilors (weekly): office records for the council body on today's date,
 *    with seats from the committed seat map (Legistar has no seat data).
 *  - Meetings first: on the first run, every meeting from six months ago onward
 *    (upcoming ones included), newest first; afterwards, meetings modified since
 *    the cursor. Roll calls are read from agenda items flagged as roll calls
 *    (Boston currently records none).
 *  - Matters: the first load walks matters introduced since the start date,
 *    newest first, a page at a time (so recent items appear at once); afterwards,
 *    matters modified since the load began, ignoring older matters that were only
 *    touched. Legislative types only (ordinances, orders, resolutions, petitions,
 *    motions); each matter's histories and sponsors are read. New actions and new
 *    matters become feed events (new matters only after the first load).
 *
 * Cursors advance per item processed, so a run cut short resumes where it
 * stopped; re-reading an unchanged matter writes nothing.
 *
 * Nothing here is Boston's except the `BOSTON` settings (a `LegistarCity`). Another
 * city on Legistar needs its own settings, a seat map, an Edge Function calling
 * `syncLegistarCity` with them, a cron schedule and a `private.job_schedule` row, and
 * an entry in the site's city registry (site/src/lib/cities.ts).
 */
import {
  BOSTON_COMMITTEES,
  BudgetExhaustedError,
  committeeSlug,
  committeesFromLocation,
  legistarMatterUrl,
  legistarUtc,
  normalizePosition,
  type LegistarClient,
  type LegistarEvent,
  type LegistarEventItem,
  type LegistarHistory,
  type LegistarMatter,
  type LegistarOfficeRecord,
  type LegistarSponsor,
} from '@civic/congress-client';
import { insertMany, upsertIfChanged, type Sql } from '../db.ts';
import { hash, writeFeedEvents, type FeedEventRow } from '../federal/events.ts';
import type { JobRun } from '../job.ts';
import { toDate } from '../text.ts';

export const BOSTON_JOB = 'boston';

/** What differs between cities on Legistar. */
export interface LegistarCity {
  /** The city key (state and name, "ma-boston"); every id of the city starts with it. */
  key: string;
  /** "Boston", for feed summaries. */
  name: string;
  /** The Legistar client name (its web addresses and API path). */
  legistar: string;
  /** The council's body name in Legistar. */
  councilBody: string;
  /** Matter types that are council legislation (Legistar's others are agendas, minutes, reports…). */
  legislativeTypes: ReadonlySet<string>;
  /** Standing committees, by name (Legistar lists no members). */
  committees: readonly string[];
  /** A matter's citation: "Docket #0123". */
  docketLabel: (file: string) => string;
  /**
   * Committees that are Legistar bodies of their own (Somerville), as body name → committee
   * name: their meetings are read with the council's and filed under that committee.
   * Without it (Boston), committee hearings are council meetings that name the committee in
   * their location text (committeesFromLocation).
   */
  committeeBodies?: Readonly<Record<string, string>>;
  /**
   * A councilor's seat from their office record title, for councils that put it there
   * ("Ward Three City Councilor"). The seat map, when it lists the person, wins.
   */
  seatFromTitle?: (title: string | null) => { seat: string; district: number | null } | null;
}
/** First load of meetings: this many days back, plus everything upcoming. */
const MEETINGS_FIRST_DAYS = 180;
/** 2: meetings carry their committees and agenda items. */
const MEETINGS_VERSION = 2;
/** Matters per page during the first load. */
const MATTER_PAGE = 100;

/** Boston's matter types that are council legislation. */
export const LEGISLATIVE_TYPES = new Set([
  'Council Ordinance',
  'Mayor Ordinance',
  'Council Order',
  'Mayor Order',
  'Loan Order',
  'Council 17F Order',
  'Council Hearing Order',
  'Council Legislative Resolution',
  'Consent Agenda Resolution',
  'Council Home Rule Petition',
  'Mayor Home Rule Petition',
  'Council Motion',
]);

export const BOSTON: LegistarCity = {
  key: 'ma-boston',
  name: 'Boston',
  legistar: 'boston',
  councilBody: 'City Council',
  legislativeTypes: LEGISLATIVE_TYPES,
  committees: BOSTON_COMMITTEES,
  docketLabel: (file) => `Docket #${file}`,
};
/** Boston's city key and council body (kept for callers that predate LegistarCity). */
export const CITY = BOSTON.key;
export const COUNCIL_BODY = BOSTON.councilBody;

export interface SeatMap {
  seats: { personId: number; name: string; seat: string; district: number | null }[];
}

export interface BostonCursor extends Record<string, unknown> {
  bodyId?: number;
  mattersSince?: string;
  eventsSince?: string;
  officialsAt?: string;
  /** True once the first full load of matters is done (enables new-matter feed events). */
  filled?: boolean;
  /** First load of matters: how many of the newest-first list are done, and when it began. */
  fillOffset?: number;
  fillStartedAt?: string;
  /** Matter types seen but not loaded (not in legislativeTypes): a new kind of legislation shows up here. */
  otherTypes?: string[];
  /** First load of meetings done (then meetings follow eventsSince). */
  eventsFilled?: boolean;
  /** Bumped when meetings gain new fields; a lower value re-reads the first-load window once. */
  meetingsVersion?: number;
  /** Legistar body ids of the city's committee bodies (committeeBodies), by body name. */
  committeeBodyIds?: Record<string, number>;
}

export interface SyncBostonOptions {
  client: LegistarClient;
  /** The city (default Boston). */
  city?: LegistarCity;
  /** Seats by Legistar person (Legistar has none); optional for a city with `seatFromTitle`. */
  seats?: SeatMap;
  /** First load: matters introduced since this date (default: 2024-01-01, the current council term). */
  startDate?: string;
  now?: () => Date;
}

export const matterKey = (matterId: number, city: LegistarCity = BOSTON) => `${city.key}-${matterId}`;
export const officialKey = (personId: number, city: LegistarCity = BOSTON) => `${city.key}-p${personId}`;

export function matterRow(
  m: LegistarMatter,
  latest?: { date: string | null; text: string | null },
  city: LegistarCity = BOSTON,
) {
  return {
    id: matterKey(m.MatterId, city),
    city: city.key,
    matter_id: m.MatterId,
    file_number: m.MatterFile,
    title: (m.MatterTitle ?? m.MatterName ?? m.MatterFile ?? `Matter ${m.MatterId}`).trim(),
    type: m.MatterTypeName,
    status: m.MatterStatusName,
    body: m.MatterBodyName,
    intro_date: toDate(m.MatterIntroDate),
    agenda_date: toDate(m.MatterAgendaDate),
    passed_date: toDate(m.MatterPassedDate),
    legistar_url: legistarMatterUrl(city.legistar, m.MatterId),
    last_modified: legistarUtc(m.MatterLastModifiedUtc),
    latest_action_date: latest?.date ?? null,
    latest_action_text: latest?.text ?? null,
  };
}

/** Oldest first; Legistar returns histories roughly chronologically but not reliably. */
export function matterActionRows(matterId: string, histories: LegistarHistory[]) {
  return [...histories]
    .sort(
      (a, b) =>
        (a.MatterHistoryActionDate ?? '').localeCompare(b.MatterHistoryActionDate ?? '') ||
        a.MatterHistoryId - b.MatterHistoryId,
    )
    .map((h, i) => ({
      matter_id: matterId,
      seq: i + 1,
      action_date: toDate(h.MatterHistoryActionDate),
      action_name: h.MatterHistoryActionName?.trim() || null,
      action_text: h.MatterHistoryActionText?.trim() || null,
      body: h.MatterHistoryActionBodyName,
      passed: h.MatterHistoryPassedFlagName,
      event_id: h.MatterHistoryEventId,
    }));
}

const actionLabel = (a: { action_name: string | null; action_text: string | null }) =>
  a.action_name ?? a.action_text ?? 'Action recorded';

export function officialRow(r: LegistarOfficeRecord, seats: SeatMap, city: LegistarCity = BOSTON) {
  const seat =
    seats.seats.find((s) => s.personId === r.OfficeRecordPersonId) ?? city.seatFromTitle?.(r.OfficeRecordTitle);
  return {
    id: officialKey(r.OfficeRecordPersonId, city),
    city: city.key,
    person_id: r.OfficeRecordPersonId,
    name: r.OfficeRecordFullName,
    first_name: r.OfficeRecordFirstName,
    last_name: r.OfficeRecordLastName,
    seat: seat?.seat ?? null,
    district: seat?.district ?? null,
    title: r.OfficeRecordTitle,
    email: r.OfficeRecordEmail,
    start_date: toDate(r.OfficeRecordStartDate),
    end_date: toDate(r.OfficeRecordEndDate),
    current: true,
  };
}

/** Eastern wall-clock date + "12:00 PM" → ISO timestamp (DST-aware via Intl). */
export function meetingStart(date: string, time: string | null): string | null {
  const day = toDate(date);
  if (!day) return null;
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(time?.trim() ?? '');
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3]!.toUpperCase() === 'PM') hour += 12;
  // Find the UTC offset New York had on that day at that time.
  const guess = new Date(`${day}T${String(hour).padStart(2, '0')}:${m[2]}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(guess)
    .find((p) => p.type === 'timeZoneName')?.value; // e.g. "GMT-4"
  const offset = Number(/GMT([+-]\d+)/.exec(parts ?? '')?.[1] ?? -5);
  return new Date(guess.getTime() - offset * 3_600_000).toISOString();
}

async function syncOfficials(
  sql: Sql,
  client: LegistarClient,
  bodyId: number,
  seats: SeatMap,
  now: Date,
  log: JobRun['log'],
  city: LegistarCity,
) {
  const records = await client.officeRecords(bodyId, now);
  const rows = records.map((r) => officialRow(r, seats, city));
  const unmapped = rows.filter((r) => !r.seat).map((r) => r.name);
  if (unmapped.length > 0) log(`councilors missing from ${city.name}'s seat map`, { unmapped });
  let written = 0;
  await sql.begin(async (tx) => {
    for (const row of rows) if (await upsertIfChanged(tx, 'public.local_officials', ['id'], row)) written += 1;
    const retired = await tx`
      update public.local_officials set current = false
       where city = ${city.key} and current and id <> all(${rows.map((r) => r.id)}::text[]) returning 1`;
    written += retired.length;
  });
  return written;
}

/** Write one matter, its actions and sponsors; returns rows written and the feed events to emit. */
export async function writeMatter(
  sql: Sql,
  matter: LegistarMatter,
  histories: LegistarHistory[],
  sponsors: LegistarSponsor[],
  filled: boolean,
  city: LegistarCity = BOSTON,
): Promise<number> {
  const id = matterKey(matter.MatterId, city);
  const actions = matterActionRows(id, histories);
  const latest = actions.at(-1);
  const row = matterRow(matter, latest ? { date: latest.action_date, text: actionLabel(latest) } : undefined, city);
  const label = matter.MatterFile ? city.docketLabel(matter.MatterFile) : `Matter ${matter.MatterId}`;
  let written = 0;

  await sql.begin(async (tx) => {
    const [existing] = await tx`select 1 from public.local_matters where id = ${id}`;
    if (await upsertIfChanged(tx, 'public.local_matters', ['id'], row)) written += 1;

    const previous = await tx<{ action_date: string | null; action_name: string | null; action_text: string | null }[]>`
      select to_char(action_date, 'YYYY-MM-DD') as action_date, action_name, action_text
        from public.local_matter_actions where matter_id = ${id}`;
    const key = (a: { action_date: string | null; action_name: string | null; action_text: string | null }) =>
      `${a.action_date}|${a.action_name}|${a.action_text}`;
    const before = new Set(previous.map(key));
    const changed = previous.length !== actions.length || actions.some((a) => !before.has(key(a)));
    const events: FeedEventRow[] = [];
    if (changed) {
      await tx`delete from public.local_matter_actions where matter_id = ${id}`;
      written += await insertMany(tx, 'public.local_matter_actions', actions);
      if (existing) {
        for (const a of actions.filter((x) => !before.has(key(x)))) {
          events.push({
            target_type: 'local_matter',
            target_id: id,
            kind: 'action',
            member_type: null,
            member_id: null,
            occurred_at: a.action_date ? `${a.action_date}T16:00:00.000Z` : new Date().toISOString(),
            summary: `${city.name} ${label}: ${actionLabel(a)}`,
            payload: { label, title: row.title, text: actionLabel(a), action_date: a.action_date, city: city.key },
            dedupe_key: `local_action:${id}:${a.action_date ?? ''}:${hash(key(a))}`,
          });
        }
      }
    }

    const sponsorRows = sponsors
      .filter((s) => s.MatterSponsorNameId)
      .map((s) => ({
        matter_id: id,
        official_id: officialKey(s.MatterSponsorNameId!, city),
        name: s.MatterSponsorName,
        sequence: s.MatterSponsorSequence,
      }));
    const unique = [...new Map(sponsorRows.map((s) => [s.official_id, s])).values()];
    for (const s of unique)
      if (await upsertIfChanged(tx, 'public.local_matter_sponsors', ['matter_id', 'official_id'], s)) written += 1;
    const removed = await tx`
      delete from public.local_matter_sponsors
       where matter_id = ${id} and official_id <> all(${unique.map((s) => s.official_id)}::text[]) returning 1`;
    written += removed.length;

    if (!existing && filled) {
      const lead = [...unique].sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99))[0];
      events.push({
        target_type: 'local_matter',
        target_id: id,
        kind: 'new_item',
        member_type: lead ? 'local_official' : null,
        member_id: lead?.official_id ?? null,
        occurred_at: row.intro_date ? `${row.intro_date}T16:00:00.000Z` : new Date().toISOString(),
        summary: `New in ${city.name} ${city.councilBody}: ${label} ${row.title}`.slice(0, 500),
        payload: { label, title: row.title, type: row.type, city: city.key },
        dedupe_key: `local_new:${id}`,
      });
    }
    written += await writeFeedEvents(tx, events);
  });
  return written;
}

/** The dockets on a meeting's agenda, in order; rewritten only when they change. */
export function meetingItemRows(meetingId: string, items: LegistarEventItem[], city: LegistarCity = BOSTON) {
  return items
    .filter((i) => i.EventItemMatterId && i.EventItemTitle?.trim())
    .map((i, n) => ({
      meeting_id: meetingId,
      seq: n + 1,
      matter_id: matterKey(i.EventItemMatterId!, city),
      file_number: i.EventItemMatterFile,
      title: i.EventItemTitle!.trim(),
    }));
}

async function writeMeetingItems(
  sql: Sql,
  meetingId: string,
  items: LegistarEventItem[],
  city: LegistarCity,
): Promise<number> {
  const rows = meetingItemRows(meetingId, items, city);
  const before = await sql<{ matter_id: string | null; title: string }[]>`
    select matter_id, title from public.local_meeting_items where meeting_id = ${meetingId} order by seq`;
  const same =
    before.length === rows.length &&
    rows.every((r, i) => r.matter_id === before[i]!.matter_id && r.title === before[i]!.title);
  if (same) return 0;
  return sql.begin(async (tx) => {
    await tx`delete from public.local_meeting_items where meeting_id = ${meetingId}`;
    return insertMany(tx, 'public.local_meeting_items', rows);
  });
}

/** The committee(s) holding a meeting: its body (cities with committee bodies) or its location text (Boston). */
export function meetingCommittees(e: Pick<LegistarEvent, 'EventBodyName' | 'EventLocation'>, city: LegistarCity) {
  if (!city.committeeBodies) return committeesFromLocation(e.EventLocation);
  const committee = city.committeeBodies[tidyName(e.EventBodyName)];
  return committee ? [committee] : [];
}

/** Legistar body names can carry stray spaces ("… Special Committee "). */
const tidyName = (name: string | null | undefined) => (name ?? '').replace(/\s+/g, ' ').trim();

/** The council body and the city's committee bodies; ids are looked up once and kept in the cursor. */
async function meetingBodyIds(client: LegistarClient, city: LegistarCity, cursor: BostonCursor, log: JobRun['log']) {
  const names = Object.keys(city.committeeBodies ?? {});
  if (names.length === 0) return cursor.bodyId!;
  const known = cursor.committeeBodyIds ?? {};
  if (names.some((n) => !(n in known)) || Object.keys(known).length !== names.length) {
    const byName = new Map((await client.bodies()).map((b) => [tidyName(b.BodyName), b.BodyId]));
    const missing = names.filter((n) => !byName.has(n));
    // A renamed committee: its meetings stop arriving until the settings follow.
    if (missing.length > 0) log(`committee bodies missing from ${city.name}'s Legistar`, { missing });
    cursor.committeeBodyIds = Object.fromEntries(names.filter((n) => byName.has(n)).map((n) => [n, byName.get(n)!]));
  }
  return [cursor.bodyId!, ...Object.values(cursor.committeeBodyIds ?? {})];
}

async function syncMeeting(sql: Sql, client: LegistarClient, e: LegistarEvent, city: LegistarCity): Promise<number> {
  const id = `${city.key}-e${e.EventId}`;
  let written = 0;
  if (
    await upsertIfChanged(sql, 'public.local_meetings', ['id'], {
      id,
      city: city.key,
      event_id: e.EventId,
      body: e.EventBodyName,
      starts_at: meetingStart(e.EventDate, e.EventTime),
      date: toDate(e.EventDate),
      time: e.EventTime,
      location: e.EventLocation,
      agenda_url: e.EventAgendaFile,
      minutes_url: e.EventMinutesFile,
      legistar_url: e.EventInSiteURL,
      status: e.EventAgendaStatusName,
      last_modified: legistarUtc(e.EventLastModifiedUtc),
      committees: meetingCommittees(e, city),
    })
  ) {
    written += 1;
  }

  const items = await client.eventItems(e.EventId);
  written += await writeMeetingItems(sql, id, items, city);

  // Roll calls: only items Legistar flags as roll calls have per-member votes.
  for (const item of items.filter((i) => i.EventItemRollCallFlag === 1)) {
    const votes = await client.eventItemVotes(item.EventItemId);
    if (votes.length === 0) continue;
    const voteId = `${city.key}-ei${item.EventItemId}`;
    const positions = votes.map((v) => ({
      vote_id: voteId,
      official_id: officialKey(v.VotePersonId, city),
      position: /absent|excused/i.test(v.VoteValueName ?? '') ? 'not_voting' : normalizePosition(v.VoteValueName),
    }));
    const count = (p: string) => positions.filter((x) => x.position === p).length;
    const matterId = item.EventItemMatterId ? matterKey(item.EventItemMatterId, city) : null;
    await sql.begin(async (tx) => {
      if (
        await upsertIfChanged(tx, 'public.local_votes', ['id'], {
          id: voteId,
          city: city.key,
          matter_id: matterId,
          meeting_id: id,
          meeting_date: toDate(e.EventDate),
          question: item.EventItemActionName ?? item.EventItemTitle,
          result: item.EventItemPassedFlagName,
          yea_total: count('yea'),
          nay_total: count('nay'),
          present_total: count('present'),
          absent_total: count('not_voting'),
          source_url: e.EventInSiteURL,
        })
      ) {
        written += 1;
      }
      for (const p of positions) {
        if (await upsertIfChanged(tx, 'public.local_vote_positions', ['vote_id', 'official_id'], p)) written += 1;
      }
      if (matterId) {
        written += await writeFeedEvents(tx, [
          {
            target_type: 'local_matter',
            target_id: matterId,
            kind: 'vote',
            member_type: null,
            member_id: null,
            occurred_at: `${toDate(e.EventDate)}T16:00:00.000Z`,
            summary: `${city.name} ${city.councilBody} vote: ${item.EventItemActionName ?? 'roll call'} ${count('yea')}–${count('nay')}`,
            payload: { local_vote_id: voteId, yea: count('yea'), nay: count('nay'), city: city.key },
            dedupe_key: `local_vote:${voteId}`,
          },
        ]);
      }
    });
  }
  return written;
}

/**
 * The council's standing committees, in the table every city shares. Legistar lists no
 * members, so a Legistar city's committees are names only; their hearings come from meetings.
 */
export async function syncBostonCommittees(sql: Sql, city: LegistarCity = BOSTON): Promise<number> {
  let written = 0;
  for (const name of city.committees) {
    const slug = committeeSlug(name);
    if (
      await upsertIfChanged(sql, 'public.local_committees', ['id'], {
        id: `${city.key}-${slug}`,
        city: city.key,
        slug,
        name,
      })
    )
      written += 1;
  }
  return written;
}

export async function syncBoston(run: JobRun<BostonCursor>, options: SyncBostonOptions): Promise<BostonCursor> {
  const { client } = options;
  const city = options.city ?? BOSTON;
  const now = options.now ?? (() => new Date());
  const cursor: BostonCursor = { ...run.cursor };
  const start = options.startDate ?? '2024-01-01T00:00:00Z';

  try {
    cursor.bodyId ??= (await client.bodyId(city.councilBody)) ?? undefined;
    if (!cursor.bodyId) throw new Error(`Legistar has no body named "${city.councilBody}"`);

    const weekAgo = now().getTime() - 7 * 24 * 3_600_000;
    if (!cursor.officialsAt || new Date(cursor.officialsAt).getTime() < weekAgo) {
      const seats = options.seats ?? { seats: [] };
      run.rowsWritten += await syncOfficials(run.sql, client, cursor.bodyId, seats, now(), run.log, city);
      run.rowsWritten += await syncBostonCommittees(run.sql, city);
      cursor.officialsAt = now().toISOString();
      await run.checkpoint(cursor);
    }

    // Resume a second early: Legistar's filter is strictly "after", and two items can share a timestamp.
    const rewind = (iso: string) => new Date(new Date(iso).getTime() - 1000).toISOString();

    // Meetings stored before committees and agenda items were kept: read them again once.
    if ((cursor.meetingsVersion ?? 1) < MEETINGS_VERSION) {
      cursor.eventsFilled = false;
      cursor.meetingsVersion = MEETINGS_VERSION;
    }

    // 1. Meetings. Few and cheap, so they never wait behind the much longer matters load.
    const bodies = await meetingBodyIds(client, city, cursor, run.log);
    if (!cursor.eventsFilled) {
      const startedAt = now().toISOString();
      const from = new Date(now().getTime() - MEETINGS_FIRST_DAYS * 86_400_000).toISOString();
      const events = await client.eventsOnOrAfter(bodies, from);
      for (const e of events) {
        if (run.outOfTime()) break;
        run.rowsWritten += await syncMeeting(run.sql, client, e, city);
      }
      if (!run.outOfTime()) {
        cursor.eventsFilled = true;
        cursor.eventsSince = startedAt;
        await run.checkpoint(cursor);
      }
      run.log('meetings first load', { listed: events.length, done: cursor.eventsFilled === true });
    } else {
      const events = await client.eventsModifiedSince(bodies, rewind(cursor.eventsSince ?? start));
      for (const e of events) {
        if (run.outOfTime()) break;
        run.rowsWritten += await syncMeeting(run.sql, client, e, city);
        cursor.eventsSince = legistarUtc(e.EventLastModifiedUtc) ?? cursor.eventsSince;
        await run.checkpoint(cursor);
      }
    }

    const syncMatter = async (m: LegistarMatter) => {
      if (m.MatterTypeName && city.legislativeTypes.has(m.MatterTypeName)) {
        const [histories, sponsors] = await Promise.all([client.histories(m.MatterId), client.sponsors(m.MatterId)]);
        run.rowsWritten += await writeMatter(run.sql, m, histories, sponsors, Boolean(cursor.filled), city);
        return true;
      }
      // Remember types that aren't loaded, so a new kind of legislation is noticed (it's in the cursor and the log).
      const type = m.MatterTypeName ?? '(none)';
      if (!(cursor.otherTypes ?? []).includes(type) && (cursor.otherTypes?.length ?? 0) < 40) {
        cursor.otherTypes = [...(cursor.otherTypes ?? []), type].sort();
        run.log('matter type not loaded', { type, city: city.key });
      }
      return false;
    };

    // 2. Matters, first load: introduced since the start date, newest first, one page at a time.
    if (!cursor.filled) {
      cursor.fillStartedAt ??= now().toISOString();
      let loaded = 0;
      while (!run.outOfTime()) {
        const page = await client.mattersIntroducedSince(cursor.bodyId, start, cursor.fillOffset ?? 0, MATTER_PAGE);
        for (const m of page) {
          if (run.outOfTime()) break;
          if (await syncMatter(m)) loaded += 1;
          cursor.fillOffset = (cursor.fillOffset ?? 0) + 1;
          if (cursor.fillOffset % 10 === 0) await run.checkpoint(cursor);
        }
        if (page.length < MATTER_PAGE && !run.outOfTime()) {
          // Done: from now on follow changes made since the load began.
          cursor.filled = true;
          cursor.mattersSince = cursor.fillStartedAt;
          break;
        }
      }
      await run.checkpoint(cursor);
      run.log('matters first load', { loaded, offset: cursor.fillOffset, done: cursor.filled === true });
      return cursor;
    }

    // 3. Matters, afterwards: changes since the cursor, ignoring old matters that were only touched.
    const matters = await client.mattersModifiedSince(cursor.bodyId, rewind(cursor.mattersSince ?? start));
    let skipped = 0;
    let sinceCheckpoint = 0;
    for (const m of matters) {
      if (run.outOfTime()) break;
      const introduced = m.MatterIntroDate ? `${m.MatterIntroDate.slice(0, 10)}T00:00:00Z` : null;
      if (!introduced || introduced < start || !(await syncMatter(m))) skipped += 1;
      cursor.mattersSince = legistarUtc(m.MatterLastModifiedUtc) ?? cursor.mattersSince;
      if (++sinceCheckpoint >= 10) {
        await run.checkpoint(cursor);
        sinceCheckpoint = 0;
      }
    }
    await run.checkpoint(cursor);
    run.log('matters', { listed: matters.length, skipped });
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      run.log('Legistar rate limited; resuming next run');
      return cursor;
    }
    throw error;
  }
  return cursor;
}

/** Any Legistar city: `syncBoston` with `options.city`. */
export const syncLegistarCity = syncBoston;
