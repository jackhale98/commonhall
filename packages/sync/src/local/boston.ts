/**
 * Nightly Boston City Council sync from Legistar.
 *
 *  - Councilors (weekly): office records for the council body on today's date,
 *    with seats from the committed seat map (Legistar has no seat data).
 *  - Matters: council matters modified since the cursor, legislative types only
 *    (ordinances, orders, resolutions, petitions, motions); each changed matter's
 *    histories and sponsors are re-read. New actions and new matters become feed
 *    events (new matters only after the first full load).
 *  - Meetings: council events modified since the cursor; roll calls are read
 *    from agenda items flagged as roll calls (Boston currently records none).
 *
 * Cursors advance per item processed, so a run cut short resumes where it
 * stopped; re-reading an unchanged matter writes nothing.
 */
import {
  BudgetExhaustedError,
  legistarMatterUrl,
  legistarUtc,
  normalizePosition,
  type LegistarClient,
  type LegistarEvent,
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
export const CITY = 'boston';
export const COUNCIL_BODY = 'City Council';

/** Matter types that are council legislation (Legistar's other types are agendas, minutes, reports…). */
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
}

export interface SyncBostonOptions {
  client: LegistarClient;
  seats: SeatMap;
  /** First run: load matters modified since this date (default: start of the current council term). */
  startDate?: string;
  now?: () => Date;
}

export const matterKey = (matterId: number) => `${CITY}-${matterId}`;
export const officialKey = (personId: number) => `${CITY}-p${personId}`;

export function matterRow(m: LegistarMatter, latest?: { date: string | null; text: string | null }) {
  return {
    id: matterKey(m.MatterId),
    city: CITY,
    matter_id: m.MatterId,
    file_number: m.MatterFile,
    title: (m.MatterTitle ?? m.MatterName ?? m.MatterFile ?? `Matter ${m.MatterId}`).trim(),
    type: m.MatterTypeName,
    status: m.MatterStatusName,
    body: m.MatterBodyName,
    intro_date: toDate(m.MatterIntroDate),
    agenda_date: toDate(m.MatterAgendaDate),
    passed_date: toDate(m.MatterPassedDate),
    legistar_url: legistarMatterUrl(CITY, m.MatterId, m.MatterGuid),
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

export function officialRow(r: LegistarOfficeRecord, seats: SeatMap) {
  const seat = seats.seats.find((s) => s.personId === r.OfficeRecordPersonId);
  return {
    id: officialKey(r.OfficeRecordPersonId),
    city: CITY,
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
) {
  const records = await client.officeRecords(bodyId, now);
  const rows = records.map((r) => officialRow(r, seats));
  const unmapped = rows.filter((r) => !r.seat).map((r) => r.name);
  if (unmapped.length > 0)
    log('councilors missing from the seat map; update supabase/data/boston-council-seats.json', { unmapped });
  let written = 0;
  await sql.begin(async (tx) => {
    for (const row of rows) if (await upsertIfChanged(tx, 'public.local_officials', ['id'], row)) written += 1;
    const retired = await tx`
      update public.local_officials set current = false
       where city = ${CITY} and current and id <> all(${rows.map((r) => r.id)}::text[]) returning 1`;
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
): Promise<number> {
  const id = matterKey(matter.MatterId);
  const actions = matterActionRows(id, histories);
  const latest = actions.at(-1);
  const row = matterRow(matter, latest ? { date: latest.action_date, text: actionLabel(latest) } : undefined);
  const label = matter.MatterFile ? `Docket #${matter.MatterFile}` : `Matter ${matter.MatterId}`;
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
            summary: `Boston ${label}: ${actionLabel(a)}`,
            payload: { label, title: row.title, text: actionLabel(a), action_date: a.action_date, city: CITY },
            dedupe_key: `local_action:${id}:${a.action_date ?? ''}:${hash(key(a))}`,
          });
        }
      }
    }

    const sponsorRows = sponsors
      .filter((s) => s.MatterSponsorNameId)
      .map((s) => ({
        matter_id: id,
        official_id: officialKey(s.MatterSponsorNameId!),
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
        summary: `New in Boston City Council: ${label} ${row.title}`.slice(0, 500),
        payload: { label, title: row.title, type: row.type, city: CITY },
        dedupe_key: `local_new:${id}`,
      });
    }
    written += await writeFeedEvents(tx, events);
  });
  return written;
}

async function syncMeeting(sql: Sql, client: LegistarClient, e: LegistarEvent): Promise<number> {
  const id = `${CITY}-e${e.EventId}`;
  let written = 0;
  if (
    await upsertIfChanged(sql, 'public.local_meetings', ['id'], {
      id,
      city: CITY,
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
    })
  ) {
    written += 1;
  }

  // Roll calls: only items Legistar flags as roll calls have per-member votes.
  const items = await client.eventItems(e.EventId);
  for (const item of items.filter((i) => i.EventItemRollCallFlag === 1)) {
    const votes = await client.eventItemVotes(item.EventItemId);
    if (votes.length === 0) continue;
    const voteId = `${CITY}-ei${item.EventItemId}`;
    const positions = votes.map((v) => ({
      vote_id: voteId,
      official_id: officialKey(v.VotePersonId),
      position: /absent|excused/i.test(v.VoteValueName ?? '') ? 'not_voting' : normalizePosition(v.VoteValueName),
    }));
    const count = (p: string) => positions.filter((x) => x.position === p).length;
    const matterId = item.EventItemMatterId ? matterKey(item.EventItemMatterId) : null;
    await sql.begin(async (tx) => {
      if (
        await upsertIfChanged(tx, 'public.local_votes', ['id'], {
          id: voteId,
          city: CITY,
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
            summary: `Boston City Council vote: ${item.EventItemActionName ?? 'roll call'} ${count('yea')}–${count('nay')}`,
            payload: { local_vote_id: voteId, yea: count('yea'), nay: count('nay'), city: CITY },
            dedupe_key: `local_vote:${voteId}`,
          },
        ]);
      }
    });
  }
  return written;
}

export async function syncBoston(run: JobRun<BostonCursor>, options: SyncBostonOptions): Promise<BostonCursor> {
  const { client } = options;
  const now = options.now ?? (() => new Date());
  const cursor: BostonCursor = { ...run.cursor };
  const start = options.startDate ?? '2024-01-01T00:00:00Z';

  try {
    cursor.bodyId ??= (await client.bodyId(COUNCIL_BODY)) ?? undefined;
    if (!cursor.bodyId) throw new Error(`Legistar has no body named "${COUNCIL_BODY}"`);

    const weekAgo = now().getTime() - 7 * 24 * 3_600_000;
    if (!cursor.officialsAt || new Date(cursor.officialsAt).getTime() < weekAgo) {
      run.rowsWritten += await syncOfficials(run.sql, client, cursor.bodyId, options.seats, now(), run.log);
      cursor.officialsAt = now().toISOString();
      await run.checkpoint(cursor);
    }

    // Resume a second early: Legistar's filter is strictly "after", and two matters can share a timestamp.
    const rewind = (iso: string) => new Date(new Date(iso).getTime() - 1000).toISOString();
    const matters = await client.mattersModifiedSince(cursor.bodyId, rewind(cursor.mattersSince ?? start));
    let skipped = 0;
    let sinceCheckpoint = 0;
    for (const m of matters) {
      if (run.outOfTime()) break;
      if (m.MatterTypeName && LEGISLATIVE_TYPES.has(m.MatterTypeName)) {
        const [histories, sponsors] = await Promise.all([client.histories(m.MatterId), client.sponsors(m.MatterId)]);
        run.rowsWritten += await writeMatter(run.sql, m, histories, sponsors, Boolean(cursor.filled));
      } else {
        skipped += 1;
      }
      cursor.mattersSince = legistarUtc(m.MatterLastModifiedUtc) ?? cursor.mattersSince;
      if (++sinceCheckpoint >= 10) {
        await run.checkpoint(cursor);
        sinceCheckpoint = 0;
      }
    }
    await run.checkpoint(cursor);
    if (!run.outOfTime()) cursor.filled = true;
    run.log('matters', { listed: matters.length, skippedNonLegislative: skipped });

    if (!run.outOfTime()) {
      const events = await client.eventsModifiedSince(cursor.bodyId, rewind(cursor.eventsSince ?? start));
      for (const e of events) {
        if (run.outOfTime()) break;
        run.rowsWritten += await syncMeeting(run.sql, client, e);
        cursor.eventsSince = legistarUtc(e.EventLastModifiedUtc) ?? cursor.eventsSince;
        await run.checkpoint(cursor);
      }
    }
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      run.log('Legistar rate limited; resuming next run');
      return cursor;
    }
    throw error;
  }
  return cursor;
}
