/**
 * Cambridge City Council, from two systems:
 *
 *  - IQM2 (cambridgema.iqm2.com), the council's portal through January 2026: a
 *    one-time backfill of meetings since 2025-01-01, newest first, each meeting's
 *    agenda (outline) and, once per legislative file, its public page (sponsors,
 *    each meeting's result and roll call). The archive no longer changes, so once
 *    the backfill is done it isn't read again. Its member list is still kept
 *    current (councillors and titles), read weekly.
 *  - PrimeGov (cambridgema.primegov.com), since January 2026: council and committee
 *    meetings each run; for each council meeting, its "Final Actions" page (items,
 *    sponsors, results and roll calls) once published, its agenda before that.
 *    A page is read again only when the city republishes it.
 *
 * Files are keyed by citation (POR 2026-185 → ma-cambridge-220260185), so a 2025
 * order acted on in 2026 is one matter: actions from IQM2 carry the IQM2 meeting id
 * as `event_id`, those from PrimeGov 1,000,000 + its meeting id, and each source
 * replaces only its own. Public communications, applications and other officers'
 * communications are left out (see CAMBRIDGE_TYPES).
 */
import {
  CAMBRIDGE,
  CAMBRIDGE_COMMITTEES,
  CAMBRIDGE_COUNCIL_GROUP,
  CAMBRIDGE_COUNCIL_PRIMEGOV,
  CAMBRIDGE_TYPES,
  CouncillorIndex,
  BudgetExhaustedError,
  cambridgeCommitteeSlug,
  cambridgeMatterId,
  cambridgeMatterNumber,
  cambridgeMeetingKind,
  cambridgeOfficialId,
  citationLabel,
  citationOf,
  flattenOutline,
  parseCambridgeActions,
  parseCitation,
  stripTitle,
  type CambridgeCitation,
  type CambridgeMeetingRecord,
  type Iqm2Client,
  type Iqm2HistoryEntry,
  type Iqm2LegiFile,
  type Iqm2Meeting,
  type Iqm2Member,
  type PrimeGovClient,
  type PrimeGovDocument,
  type PrimeGovMeeting,
} from '@civic/congress-client';
import { insertMany, upsertIfChanged, type AnySql, type Sql } from '../db.ts';
import { hash, writeFeedEvents, type FeedEventRow } from '../federal/events.ts';
import type { JobRun } from '../job.ts';
import { meetingStart } from './boston.ts';

export const CAMBRIDGE_JOB = 'cambridge';
/** IQM2 is read for meetings from this date up to PRIMEGOV_SINCE. */
export const CAMBRIDGE_SINCE = '2025-01-01';
/** The first day of PrimeGov's record; IQM2 meetings from here on are left to it. */
export const PRIMEGOV_SINCE = '2026-01-01';
/** PrimeGov meeting ids are offset in `event_id` so they can't collide with IQM2's. */
export const PRIMEGOV_EVENT_OFFSET = 1_000_000;
/** PrimeGov's committee ids for the council and its committees (others are boards and commissions). */
const PRIMEGOV_COUNCIL_BODIES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 55]);
const MIN_COUNCILLORS = 9;

export interface CambridgeCursor extends Record<string, unknown> {
  peopleAt?: string;
  /** IQM2 meetings still to read (newest first); undefined until listed. */
  iqm2Queue?: number[];
  /** IQM2 legislative files already read (each once). */
  iqm2Files?: number[];
  /** True once the IQM2 archive is loaded. */
  iqm2Done?: boolean;
  /** PrimeGov pages read: meeting id → "{template id}@{publish date}". */
  pgRead?: Record<string, string>;
  /** True once every PrimeGov meeting has been read once (enables feed events). */
  pgFilled?: boolean;
}

export interface SyncCambridgeOptions {
  iqm2: Iqm2Client;
  primegov: PrimeGovClient;
  now?: () => Date;
}

// ---- Rows -------------------------------------------------------------------

export function cambridgeOfficialRow(m: Iqm2Member) {
  const name = m.FullName.trim();
  const words = stripTitle(name).split(/\s+/);
  return {
    id: cambridgeOfficialId(name),
    city: CAMBRIDGE,
    person_id: m.UserID,
    name,
    first_name: words[0] ?? null,
    last_name: words.at(-1) ?? null,
    seat: 'At-Large',
    district: null,
    title: /mayor/i.test(m.Title ?? '') ? m.Title!.replace(/\s+chair$/i, '').trim() : null,
    current: true,
  };
}

/** A councillor seen in 2025's records who is no longer on the council. */
export function formerOfficialRow(printed: string) {
  const name = stripTitle(printed);
  const words = name.split(/\s+/);
  return {
    id: cambridgeOfficialId(name),
    city: CAMBRIDGE,
    person_id: null,
    name,
    first_name: words[0] ?? null,
    last_name: words.at(-1) ?? null,
    seat: 'At-Large',
    district: null,
    title: null,
    current: false,
  };
}

/** "5:30 PM" from an ISO local time "2025-12-22T17:30:00.0000000-05:00". */
function clockTime(iso: string): string | null {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

export function iqm2MeetingRow(m: Iqm2Meeting, iqm2: Iqm2Client, agendaUrl: string | null, minutesUrl: string | null) {
  const kind = cambridgeMeetingKind(m.Department.Name === 'City Council' ? m.Type.Name : m.Department.Name);
  const committees = m.Department.ID === CAMBRIDGE_COUNCIL_GROUP ? [] : kind.committees;
  if (committees === null) return null;
  const date = m.Date.slice(0, 10);
  const starts = new Date(m.Date);
  return {
    id: `${CAMBRIDGE}-m${m.ID}`,
    city: CAMBRIDGE,
    event_id: m.ID,
    body: m.Department.Name === 'City Council' ? 'City Council' : m.Department.Name,
    starts_at: Number.isNaN(starts.getTime()) ? null : starts.toISOString(),
    date,
    time: clockTime(m.Date),
    location: m.Location?.Name?.trim() || null,
    agenda_url: agendaUrl,
    minutes_url: minutesUrl,
    legistar_url: iqm2.meetingUrl(m.ID),
    status: /cancel/i.test(m.Status) || kind.cancelled ? 'Cancelled' : null,
    committees,
  };
}

const findDoc = (m: PrimeGovMeeting, re: RegExp): PrimeGovDocument | undefined =>
  m.documentList.find((d) => re.test(d.templateName.trim()));

/** A PrimeGov council or committee meeting as a local_meetings row, or null for boards and commissions. */
export function primeGovMeetingRow(m: PrimeGovMeeting, primegov: PrimeGovClient) {
  if (!PRIMEGOV_COUNCIL_BODIES.has(m.committeeId)) return null;
  const kind = cambridgeMeetingKind(m.title);
  const committees = m.committeeId === CAMBRIDGE_COUNCIL_PRIMEGOV ? [] : kind.committees;
  if (committees === null || /do not use/i.test(m.title)) return null;
  const agenda = findDoc(m, /^agenda$/i) ?? findDoc(m, /^html agenda$/i);
  const minutes = findDoc(m, /^minutes$/i) ?? findDoc(m, /^html minutes$/i);
  const date = m.dateTime.slice(0, 10);
  return {
    id: `${CAMBRIDGE}-pg${m.id}`,
    city: CAMBRIDGE,
    event_id: PRIMEGOV_EVENT_OFFSET + m.id,
    body: committees.length ? committees.join(' and ') : 'City Council',
    starts_at: meetingStart(date, m.time),
    date,
    time: m.time?.replace(/^0/, '') ?? null,
    location: m.location?.trim() || null,
    agenda_url: agenda ? primegov.documentUrl(agenda) : null,
    minutes_url: minutes ? primegov.documentUrl(minutes) : null,
    legistar_url: primegov.portalUrl,
    status: kind.cancelled ? 'Cancelled' : null,
    committees,
  };
}

// ---- Matters ----------------------------------------------------------------

/** One meeting's action on a file. */
export interface CambridgeAction {
  date: string | null;
  /** "Order Adopted", "Referred to the Ordinance Committee". */
  name: string;
  text: string | null;
  body: string;
  passed: string | null;
  /** IQM2 meeting id, or PRIMEGOV_EVENT_OFFSET + PrimeGov meeting id. */
  eventId: number;
  /** Named roll call, when recorded. */
  vote: {
    yes: number;
    no: number;
    yeas: string[];
    nays: string[];
    present: string[];
    absent: string[];
  } | null;
}

export interface CambridgeMatterInput {
  citation: CambridgeCitation;
  title: string;
  url: string;
  /** Printed sponsor names, in order. */
  sponsors: string[];
  /** Actions from one source: they replace that source's earlier ones (see `replaces`). */
  actions: CambridgeAction[];
  /** Which stored actions the new ones replace. */
  replaces: (eventId: number | null) => boolean;
  /** A status to use when there are no actions (IQM2's stamp). */
  fallbackStatus?: string | null;
}

/** "ORDER ADOPTED" → "Order Adopted"; mixed case is kept. */
export function tidyResult(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/(?<=\s)(Of|To|The|And|On|As|By|For|In|A)\b/g, (w) => w.toLowerCase())
    .replace(/\bCma\b/g, 'CMA');
}

const PASSED = /\b(adopted|ordained|approved|accepted|passed to a second reading)\b/i;
const FAILED = /\b(failed|defeated|rejected|not adopted)\b/i;

export function passedFlag(result: string): string | null {
  if (FAILED.test(result)) return 'Fail';
  if (PASSED.test(result)) return 'Pass';
  return null;
}

/** IQM2 history → actions (meetings before PrimeGov's start). */
export function iqm2Actions(history: Iqm2HistoryEntry[]): CambridgeAction[] {
  return history
    .filter((h) => h.meetingId !== null && (!h.date || h.date < PRIMEGOV_SINCE))
    .map((h) => {
      const v = h.vote;
      const yeas = v?.yeas ?? [];
      const named = v && (yeas.length > 0 || v.nays.length > 0);
      const result = v ? tidyResult(v.result) : 'On the agenda';
      return {
        date: h.date,
        name: result,
        text: h.comments,
        body: h.body ?? 'City Council',
        passed: v ? passedFlag(v.result) : null,
        eventId: h.meetingId!,
        vote: named
          ? {
              yes: v.yes ?? yeas.length,
              no: v.no ?? v.nays.length,
              yeas,
              nays: v.nays,
              present: v.present,
              absent: v.absent,
            }
          : null,
      };
    });
}

/** One PrimeGov meeting's items → actions. */
export function primeGovActions(record: CambridgeMeetingRecord, meetingId: number, date: string) {
  return record.items.map((item) => {
    const v = item.vote;
    const named = v && !v.voice && (v.yeas.length > 0 || v.nays.length > 0);
    return {
      item,
      action: {
        date: record.date ?? date,
        name: v ? tidyResult(v.result) : 'On the agenda',
        text: item.notes[0] ?? null,
        body: 'City Council',
        passed: v ? passedFlag(v.result) : null,
        eventId: PRIMEGOV_EVENT_OFFSET + meetingId,
        vote: named
          ? {
              yes: v.yes ?? v.yeas.length,
              no: v.no ?? v.nays.length,
              yeas: v.yeas,
              nays: v.nays,
              present: v.present,
              absent: v.absent,
            }
          : null,
      } satisfies CambridgeAction,
    };
  });
}

interface StoredAction {
  action_date: string | null;
  action_name: string | null;
  action_text: string | null;
  body: string | null;
  passed: string | null;
  event_id: number | null;
}

const actionKey = (a: StoredAction) => `${a.action_date}|${a.event_id}|${a.action_name}|${a.action_text}`;

/**
 * Write one file: the matter, its actions (merged with the other source's), its
 * sponsors and its roll calls. Feed events (new matter, new action) only when `feed`.
 */
export async function writeCambridgeMatter(
  sql: Sql,
  input: CambridgeMatterInput,
  people: CouncillorIndex,
  feed: boolean,
  log: JobRun['log'] = () => undefined,
): Promise<number> {
  const id = cambridgeMatterId(input.citation);
  const matterNumber = cambridgeMatterNumber(input.citation);
  if (!id || matterNumber === null) return 0;
  const kind = CAMBRIDGE_TYPES[input.citation.prefix]!;
  const label = citationLabel(input.citation);
  let written = 0;

  await sql.begin(async (tx) => {
    const [existing] = await tx<{ title: string; legistar_url: string | null }[]>`
      select title, legistar_url from public.local_matters where id = ${id}`;
    const previous = await tx<StoredAction[]>`
      select to_char(action_date, 'YYYY-MM-DD') as action_date, action_name, action_text, body, passed, event_id
        from public.local_matter_actions where matter_id = ${id} order by seq`;
    const incoming: StoredAction[] = input.actions.map((a) => ({
      action_date: a.date,
      action_name: a.name,
      action_text: a.text,
      body: a.body,
      passed: a.passed,
      event_id: a.eventId,
    }));
    const merged = [...previous.filter((a) => !input.replaces(a.event_id)), ...incoming].sort(
      (a, b) => (a.action_date ?? '').localeCompare(b.action_date ?? '') || (a.event_id ?? 0) - (b.event_id ?? 0),
    );
    const unique = [...new Map(merged.map((a) => [actionKey(a), a])).values()];
    const latest = unique.at(-1);
    const dates = unique.map((a) => a.action_date).filter((d): d is string => !!d);
    const passed = unique.filter((a) => a.passed === 'Pass' && a.action_date).at(-1);
    // The newest record's wording and link win: an older meeting read later keeps them.
    const newest =
      input.actions
        .map((a) => a.date ?? '')
        .sort()
        .at(-1) ?? '';
    const older = existing && previous.some((a) => (a.action_date ?? '') > newest);

    const row = {
      id,
      city: CAMBRIDGE,
      matter_id: matterNumber,
      file_number: label,
      title: older ? existing.title : input.title.slice(0, 4000),
      type: kind.type,
      status: latest?.action_name ?? (input.fallbackStatus ? tidyResult(input.fallbackStatus) : null),
      body: 'City Council',
      intro_date: dates[0] ?? null,
      agenda_date: dates.at(-1) ?? null,
      passed_date: passed?.action_date ?? null,
      legistar_url: older ? existing.legistar_url : input.url,
      latest_action_date: latest?.action_date ?? null,
      latest_action_text: latest
        ? latest.action_text
          ? `${latest.action_name}: ${latest.action_text}`
          : latest.action_name
        : null,
    };
    if (await upsertIfChanged(tx, 'public.local_matters', ['id'], row)) written += 1;

    const before = new Set(previous.map(actionKey));
    const changed =
      previous.length !== unique.length || unique.some((a, i) => actionKey(a) !== actionKey(previous[i]!));
    const events: FeedEventRow[] = [];
    if (changed) {
      await tx`delete from public.local_matter_actions where matter_id = ${id}`;
      written += await insertMany(
        tx,
        'public.local_matter_actions',
        unique.map((a, i) => ({ matter_id: id, seq: i + 1, ...a })),
      );
      if (existing && feed) {
        for (const a of unique.filter((x) => !before.has(actionKey(x)))) {
          events.push({
            target_type: 'local_matter',
            target_id: id,
            kind: 'action',
            member_type: null,
            member_id: null,
            occurred_at: a.action_date ? `${a.action_date}T16:00:00.000Z` : new Date().toISOString(),
            summary: `Cambridge ${label}: ${a.action_name}`.slice(0, 500),
            payload: { label, title: row.title, text: a.action_name, action_date: a.action_date, city: CAMBRIDGE },
            dedupe_key: `local_action:${id}:${a.action_date ?? ''}:${hash(actionKey(a))}`,
          });
        }
      }
    }

    // Sponsors: added as they appear (co-sponsors join later), matched to councillors.
    const sponsorIds: string[] = [];
    for (const [n, printed] of input.sponsors.entries()) {
      const official = people.find(printed);
      if (!official) {
        log('sponsor not matched to a councillor', { name: printed, matter: label });
        continue;
      }
      if (sponsorIds.includes(official)) continue;
      sponsorIds.push(official);
      if (
        await upsertIfChanged(tx, 'public.local_matter_sponsors', ['matter_id', 'official_id'], {
          matter_id: id,
          official_id: official,
          name: people.people.find((p) => p.id === official)?.name ?? stripTitle(printed),
          sequence: n + 1,
        })
      )
        written += 1;
    }

    // Roll calls (not for ceremonial resolutions, which pass together).
    if (input.citation.prefix !== 'RES') written += await writeVotes(tx, id, matterNumber, input.actions, people, log);

    if (!existing && feed) {
      const lead = sponsorIds[0];
      events.push({
        target_type: 'local_matter',
        target_id: id,
        kind: 'new_item',
        member_type: lead ? 'local_official' : null,
        member_id: lead ?? null,
        occurred_at: row.intro_date ? `${row.intro_date}T16:00:00.000Z` : new Date().toISOString(),
        summary: `New in Cambridge City Council: ${label} ${row.title}`.slice(0, 500),
        payload: { label, title: row.title, type: row.type, city: CAMBRIDGE },
        dedupe_key: `local_new:${id}`,
      });
    }
    written += await writeFeedEvents(tx, events);
  });
  return written;
}

/** `ma-cambridge-ei{matter number}{yyyymmdd}`: one roll call per file per meeting day. */
export const cambridgeVoteId = (matterNumber: number, date: string) =>
  `${CAMBRIDGE}-ei${matterNumber}${date.replace(/-/g, '')}`;

async function writeVotes(
  tx: AnySql,
  matterId: string,
  matterNumber: number,
  actions: CambridgeAction[],
  people: CouncillorIndex,
  log: JobRun['log'],
): Promise<number> {
  let written = 0;
  for (const a of actions) {
    if (!a.vote || !a.date) continue;
    const voteId = cambridgeVoteId(matterNumber, a.date);
    const positions = new Map<string, string>();
    const unmatched: string[] = [];
    const place = (names: string[], position: string) => {
      for (const n of names) {
        const official = people.find(n);
        if (official) positions.set(official, position);
        else unmatched.push(n);
      }
    };
    place(a.vote.yeas, 'yea');
    place(a.vote.nays, 'nay');
    place(a.vote.present, 'present');
    place(a.vote.absent, 'not_voting');
    if (unmatched.length) log('voters not matched to a councillor', { names: unmatched, vote: voteId });
    const count = (p: string) => [...positions.values()].filter((x) => x === p).length;
    if (
      await upsertIfChanged(tx, 'public.local_votes', ['id'], {
        id: voteId,
        city: CAMBRIDGE,
        matter_id: matterId,
        meeting_id:
          a.eventId >= PRIMEGOV_EVENT_OFFSET
            ? `${CAMBRIDGE}-pg${a.eventId - PRIMEGOV_EVENT_OFFSET}`
            : `${CAMBRIDGE}-m${a.eventId}`,
        meeting_date: a.date,
        question: a.name,
        result: a.passed ?? (a.vote.yes > a.vote.no ? 'Pass' : 'Fail'),
        yea_total: a.vote.yeas.length ? count('yea') : a.vote.yes,
        nay_total: a.vote.nays.length ? count('nay') : a.vote.no,
        present_total: count('present'),
        absent_total: count('not_voting'),
        source_url: null,
      })
    )
      written += 1;
    for (const [official, position] of positions)
      if (
        await upsertIfChanged(tx, 'public.local_vote_positions', ['vote_id', 'official_id'], {
          vote_id: voteId,
          official_id: official,
          position,
        })
      )
        written += 1;
  }
  return written;
}

/** Agenda items that are files we keep, in order; rewritten only when they change. */
export async function writeCambridgeMeetingItems(
  sql: Sql,
  meetingId: string,
  items: { citation: CambridgeCitation; title: string }[],
): Promise<number> {
  const rows = items
    .map((i) => ({ ...i, matter: cambridgeMatterId(i.citation) }))
    .filter((i) => i.matter !== null)
    .map((i, n) => ({
      meeting_id: meetingId,
      seq: n + 1,
      matter_id: i.matter,
      file_number: citationLabel(i.citation),
      title: i.title.slice(0, 2000),
    }));
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

// ---- People -----------------------------------------------------------------

async function loadPeople(sql: Sql): Promise<CouncillorIndex> {
  const rows = await sql<{ id: string; name: string }[]>`
    select id, name from public.local_officials where city = ${CAMBRIDGE} order by current desc, id`;
  return new CouncillorIndex(rows);
}

async function syncPeople(sql: Sql, iqm2: Iqm2Client): Promise<number> {
  const members = await iqm2.members(CAMBRIDGE_COUNCIL_GROUP);
  if (members.length < MIN_COUNCILLORS)
    throw new Error(`IQM2 lists ${members.length} councillors; expected ${MIN_COUNCILLORS}`);
  const rows = members.map(cambridgeOfficialRow);
  let written = 0;
  await sql.begin(async (tx) => {
    for (const row of rows) if (await upsertIfChanged(tx, 'public.local_officials', ['id'], row)) written += 1;
    const retired = await tx`
      update public.local_officials set current = false
       where city = ${CAMBRIDGE} and current and id <> all(${rows.map((r) => r.id)}::text[]) returning 1`;
    written += retired.length;
    for (const name of CAMBRIDGE_COMMITTEES) {
      const slug = cambridgeCommitteeSlug(name);
      if (
        await upsertIfChanged(tx, 'public.local_committees', ['id'], {
          id: `${CAMBRIDGE}-${slug}`,
          city: CAMBRIDGE,
          slug,
          name,
        })
      )
        written += 1;
    }
  });
  return written;
}

/** Councillors named in 2025's records who have left the council, so their votes and orders are theirs. */
async function addFormerCouncillors(sql: Sql, people: CouncillorIndex, file: Iqm2LegiFile): Promise<number> {
  const names = [
    ...file.sponsors.filter((s) => /^(councill?or|mayor|vice mayor)\s/i.test(s)),
    ...file.history.flatMap((h) =>
      h.vote ? [...h.vote.yeas, ...h.vote.nays, ...h.vote.absent, ...h.vote.present, ...h.vote.recused] : [],
    ),
  ];
  let written = 0;
  for (const printed of names) {
    if (people.find(printed)) continue;
    const name = stripTitle(printed);
    // A full name (two words or more); a bare surname can't be placed.
    if (name.split(/\s+/).length < 2) continue;
    const row = formerOfficialRow(name);
    if (await upsertIfChanged(sql, 'public.local_officials', ['id'], row)) written += 1;
    people.add(row.id, row.name);
  }
  return written;
}

// ---- The two sources --------------------------------------------------------

/** IQM2's archive: list the meetings once, then work through them newest first. */
async function syncIqm2(run: JobRun<CambridgeCursor>, options: SyncCambridgeOptions, people: CouncillorIndex) {
  const { iqm2 } = options;
  const cursor = run.cursor;
  if (!cursor.iqm2Queue) {
    const bodies = (await iqm2.departments()).filter(
      (d) => d.ID === CAMBRIDGE_COUNCIL_GROUP || (cambridgeMeetingKind(d.Name).committees?.length ?? 0) > 0,
    );
    const listed: Iqm2Meeting[] = [];
    const first = Number(CAMBRIDGE_SINCE.slice(0, 4));
    const last = Number(PRIMEGOV_SINCE.slice(0, 4));
    for (const body of bodies)
      for (let year = first; year <= last; year++)
        listed.push(...(await iqm2.meetings(year, body.ID)).map((l) => l.Meeting));
    const council = listed.filter((m) => m.Department.ID === CAMBRIDGE_COUNCIL_GROUP);
    if (council.length < 20) throw new Error(`IQM2 lists ${council.length} council meetings since ${CAMBRIDGE_SINCE}`);
    cursor.iqm2Queue = listed
      .filter((m) => m.Date.slice(0, 10) >= CAMBRIDGE_SINCE && m.Date.slice(0, 10) < PRIMEGOV_SINCE)
      .sort((a, b) => b.Date.localeCompare(a.Date) || b.ID - a.ID)
      .map((m) => m.ID);
    cursor.iqm2Files = [];
    await run.checkpoint(cursor);
    run.log('iqm2 meetings listed', { meetings: cursor.iqm2Queue.length, bodies: bodies.length });
  }
  const done = new Set(cursor.iqm2Files ?? []);
  while (cursor.iqm2Queue.length > 0 && !run.outOfTime()) {
    const meetingId = cursor.iqm2Queue[0]!;
    const outline = await iqm2.outline(meetingId);
    const agenda = outline.Agenda;
    const row = iqm2MeetingRow(
      outline.Meeting,
      iqm2,
      agenda ? `${iqm2.baseUrl}/Citizens/FileOpen.aspx?Type=1&ID=${agenda.ID}` : null,
      null,
    );
    if (row) {
      if (await upsertIfChanged(run.sql, 'public.local_meetings', ['id'], row)) run.rowsWritten += 1;
      const items = flattenOutline(agenda?.Outline ?? [])
        .filter((i) => !i.WasDeleted && i.ReferencedItem && i.ItemType !== 'Attachment')
        .map((i) => ({ item: i, citation: citationOf(i.Title) }))
        .filter((i): i is { item: typeof i.item; citation: CambridgeCitation } => i.citation !== null);
      run.rowsWritten += await writeCambridgeMeetingItems(
        run.sql,
        row.id,
        items.map((i) => ({ citation: i.citation, title: i.item.Title.replace(/^[^:]*:\s*/, '') })),
      );
      for (const { item, citation } of items) {
        const fileId = item.ReferencedItem!.ID;
        if (done.has(fileId) || cambridgeMatterId(citation) === null) continue;
        if (run.outOfTime()) break;
        const file = await iqm2.legiFile(fileId);
        const fileCitation = parseCitation(file.number) ?? citation;
        run.rowsWritten += await addFormerCouncillors(run.sql, people, file);
        run.rowsWritten += await writeCambridgeMatter(
          run.sql,
          {
            citation: fileCitation,
            title: file.title ?? item.Title.replace(/^[^:]*:\s*/, ''),
            url: iqm2.legiFileUrl(fileId),
            sponsors: file.sponsors,
            actions: iqm2Actions(file.history),
            replaces: (eventId) => eventId === null || eventId < PRIMEGOV_EVENT_OFFSET,
            fallbackStatus: file.status,
          },
          people,
          false,
          run.log,
        );
        done.add(fileId);
      }
    }
    if (run.outOfTime()) break;
    cursor.iqm2Queue = cursor.iqm2Queue.slice(1);
    cursor.iqm2Files = [...done];
    await run.checkpoint(cursor);
  }
  cursor.iqm2Files = [...done];
  if (cursor.iqm2Queue.length === 0) {
    cursor.iqm2Done = true;
    cursor.iqm2Files = [];
  }
  await run.checkpoint(cursor);
  run.log('iqm2', { left: cursor.iqm2Queue.length, files: done.size, done: cursor.iqm2Done === true });
}

/** A PrimeGov page's version: its template and when it was published. */
const pageVersion = (d: PrimeGovDocument & { publishDate?: string }) => `${d.templateId}@${d.publishDate ?? ''}`;

async function syncPrimeGov(run: JobRun<CambridgeCursor>, options: SyncCambridgeOptions, people: CouncillorIndex) {
  const { primegov } = options;
  const cursor = run.cursor;
  const year = (options.now?.() ?? new Date()).getUTCFullYear();
  const firstYear = Number(PRIMEGOV_SINCE.slice(0, 4));
  const lists = await Promise.all([
    ...(cursor.pgFilled || year - 1 < firstYear ? [] : [primegov.archived(year - 1)]),
    primegov.archived(year),
    primegov.upcoming(),
  ]);
  const meetings = [...new Map(lists.flat().map((m) => [m.id, m])).values()]
    .filter((m) => m.dateTime.slice(0, 10) >= PRIMEGOV_SINCE)
    .sort((a, b) => b.dateTime.localeCompare(a.dateTime));
  const rows = meetings.map((m) => ({ m, row: primeGovMeetingRow(m, primegov) })).filter((x) => x.row !== null);
  if (meetings.length >= 20 && !rows.some((x) => x.m.committeeId === CAMBRIDGE_COUNCIL_PRIMEGOV))
    throw new Error(`None of ${meetings.length} PrimeGov meetings is a City Council meeting; has the portal changed?`);
  let written = 0;
  for (const { row } of rows) if (await upsertIfChanged(run.sql, 'public.local_meetings', ['id'], row!)) written += 1;
  run.rowsWritten += written;

  // Each meeting's page: final actions once published (council only), the agenda before.
  const read = { ...(cursor.pgRead ?? {}) };
  const feed = cursor.pgFilled === true;
  let pages = 0;
  let complete = true;
  for (const { m, row } of rows) {
    if (run.outOfTime()) {
      complete = false;
      break;
    }
    // Committee agendas list topics, rarely filed items: only council meetings are read.
    if (m.committeeId !== CAMBRIDGE_COUNCIL_PRIMEGOV) continue;
    const doc = findDoc(m, /^html final actions$/i) ?? findDoc(m, /^html agenda$/i);
    if (!doc || row!.status === 'Cancelled') continue;
    const version = pageVersion(doc);
    if (read[String(m.id)] === version) continue;
    const record = parseCambridgeActions(await primegov.http.getText(primegov.documentUrl(doc), 'text/html'));
    pages += 1;
    run.rowsWritten += await writeCambridgeMeetingItems(run.sql, row!.id, record.items);
    for (const { item, action } of primeGovActions(record, m.id, row!.date)) {
      run.rowsWritten += await writeCambridgeMatter(
        run.sql,
        {
          citation: item.citation,
          title: item.title,
          url: primegov.documentUrl(doc),
          sponsors: item.sponsors,
          actions: [action],
          replaces: (eventId) => eventId === action.eventId,
        },
        people,
        feed,
        run.log,
      );
    }
    read[String(m.id)] = version;
    cursor.pgRead = read;
    await run.checkpoint(cursor);
  }
  if (complete) cursor.pgFilled = true;
  await run.checkpoint(cursor);
  run.log('primegov', { meetings: rows.length, written, pages, filled: cursor.pgFilled === true });
}

export async function syncCambridge(
  run: JobRun<CambridgeCursor>,
  options: SyncCambridgeOptions,
): Promise<CambridgeCursor> {
  const now = options.now ?? (() => new Date());
  run.cursor = { ...run.cursor };
  try {
    const weekAgo = now().getTime() - 7 * 86_400_000;
    if (!run.cursor.peopleAt || new Date(run.cursor.peopleAt).getTime() < weekAgo) {
      run.rowsWritten += await syncPeople(run.sql, options.iqm2);
      run.cursor.peopleAt = now().toISOString();
      await run.checkpoint(run.cursor);
    }
    const people = await loadPeople(run.sql);
    // Current meetings first (cheap), then the archive while time remains.
    await syncPrimeGov(run, options, people);
    if (!run.cursor.iqm2Done && !run.outOfTime()) await syncIqm2(run, options, people);
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      run.log('rate limited; resuming next run');
      return run.cursor;
    }
    throw error;
  }
  return run.cursor;
}
