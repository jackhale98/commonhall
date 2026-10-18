/**
 * The items on Worcester City Council agendas (orders, resolutions, petitions, City
 * Manager communications, committee reports, hearings, ordinances) into the council
 * matters, from PrimeGov: the HTML agenda where there is one (meetings before
 * mid-2026), else the agenda PDF read with `pdftotext -layout`.
 *
 * Each item is a matter (`ma-worcester-{meeting id × 1000 + position}`), shown as
 * "Item 12a, Oct 6, 2026", with what the council was asked to do as its latest
 * action and its sponsors matched to councilors. An item held or tabled from an
 * earlier meeting (same type and wording) keeps its first matter, so it has one
 * page and one discussion. Outcomes are in the minutes PDFs and are not read yet.
 *
 * Meetings already loaded are read again only while they are recent (agendas get
 * revised). Run by scripts/load-worcester-agendas.ts ("Load Worcester agendas").
 */
import {
  classifyAgendaItem,
  parseAgendaHtml,
  parseAgendaText,
  worcesterMeetingKind,
  worcesterOfficialId,
  type AgendaItem,
  type HttpClient,
  type PrimeGovClient,
  type PrimeGovMeeting,
} from '@civic/congress-client';
import type { Sql } from '../db.ts';
import type { PdfText } from './pdf.ts';

const CITY = 'ma-worcester';
/** Types that are held, tabled or carried to later meetings with the same wording. */
const CARRIED = new Set(['Order', 'Resolution', 'Ordinance', 'City Manager communication', 'Communication']);
/** Meetings this recent are read again each run. */
export const WORCESTER_REVISABLE_DAYS = 14;
/** An agenda with fewer items than this is a misread, not a short meeting. */
export const WORCESTER_MIN_ITEMS = 10;
/** Stop reading new agendas after this long (the workflow allows 30 minutes). */
export const WORCESTER_AGENDAS_RUN_MINUTES = 18;

export interface WorcesterAgendasOptions {
  /** Meeting lists and document URLs. */
  primegov: Pick<PrimeGovClient, 'archived' | 'upcoming' | 'documentUrl'>;
  /** Fetches the agenda documents (an `HttpClient`, which checks each response's status). */
  http: Pick<HttpClient, 'get'>;
  pdfText: PdfText;
  /** First meeting date read (YYYY-MM-DD); default 1 January of last year. */
  since?: string;
  /** Read every meeting again, not only recent or new ones. */
  force?: boolean;
  /** The clock: sets the years listed, which meetings are recent, and when to stop. */
  now?: () => Date;
  /** Stop reading new agendas after this many ms; what is left waits for the next run. */
  runMs?: number;
  minItems?: number;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

const key = (type: string, title: string) => `${type}|${title.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 300)}`;
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

type Agenda = { items: AgendaItem[]; url: string };
type Existing = Map<string, { id: string; type: string; title: string; agenda_date: string }>;

/** The agenda's items and where they came from, or null when the meeting has no agenda yet. */
async function readAgenda(
  primegov: WorcesterAgendasOptions['primegov'],
  http: WorcesterAgendasOptions['http'],
  pdfText: PdfText,
  m: PrimeGovMeeting,
): Promise<Agenda | null> {
  const html = m.documentList.find((d) => /^html? agenda$/i.test(d.templateName.trim()) && d.compileOutputType === 3);
  if (html) {
    const url = primegov.documentUrl(html);
    return { items: parseAgendaHtml(await (await http.get(url, 'text/html')).text()), url };
  }
  const pdf = m.documentList.find((d) => /^agenda$/i.test(d.templateName.trim()));
  if (!pdf) return null;
  const url = primegov.documentUrl(pdf);
  const bytes = new Uint8Array(await (await http.get(url, 'application/pdf')).arrayBuffer());
  return { items: parseAgendaText(pdfText(bytes, { layout: true })), url };
}

/**
 * Write one meeting's agenda in a few statements: its items replace the meeting's
 * earlier ones, new items become matters, and an item carried from an earlier
 * meeting moves its matter's latest action instead. Returns the items written.
 */
async function writeAgenda(
  sql: Sql,
  m: PrimeGovMeeting,
  date: string,
  meetingId: string,
  agenda: Agenda,
  existing: Existing,
  officialFor: (name: string) => string | null,
): Promise<number> {
  const matters: Record<string, unknown>[] = [];
  const carried: { id: string; action: string }[] = [];
  const sponsors: { matter_id: string; official_id: string; name: string; sequence: number }[] = [];
  const items: Record<string, unknown>[] = [];
  const actions = new Map<string, Record<string, unknown>>();
  let seq = 0;
  for (const item of agenda.items) {
    seq++;
    const c = classifyAgendaItem(item);
    if (!c) continue;
    const label = `${item.number}, ${shortDate(date)}`;
    const action = `On the agenda${item.action ? `: ${item.action}` : ''}`;
    const prior = CARRIED.has(c.type) ? existing.get(key(c.type, c.title)) : undefined;
    const id = prior && prior.agenda_date < date ? prior.id : `${CITY}-${m.id * 1000 + seq}`;
    if (prior && prior.id === id && prior.agenda_date < date) {
      carried.push({ id, action });
    } else {
      matters.push({
        id,
        city: CITY,
        matter_id: m.id * 1000 + seq,
        file_number: label,
        title: c.title,
        type: c.type,
        status: null,
        body: item.section,
        intro_date: date,
        agenda_date: date,
        passed_date: null,
        legistar_url: agenda.url,
        last_modified: `${date}T12:00:00Z`,
        latest_action_date: date,
        latest_action_text: action,
      });
      existing.set(key(c.type, c.title), { id, type: c.type, title: c.title, agenda_date: date });
      const named = [
        ...new Map(c.sponsors.map((name) => [officialFor(name), name] as const).filter(([oid]) => oid !== null)),
      ];
      named.forEach(([official_id, name], i) =>
        sponsors.push({ matter_id: id, official_id: official_id!, name, sequence: i + 1 }),
      );
    }
    items.push({ meeting_id: meetingId, seq, matter_id: id, file_number: item.number, title: c.title });
    // Each appearance on an agenda is an action, so a carried item shows its history.
    actions.set(id, {
      matter_id: id,
      seq: m.id,
      action_date: date,
      action_name: item.action ?? 'On the agenda',
      action_text: `Item ${item.number} on the City Council agenda`,
      body: 'City Council',
      passed: null,
      event_id: m.id,
    });
  }
  await sql.begin(async (tx) => {
    await tx`delete from public.local_meeting_items where meeting_id = ${meetingId}`;
    await tx`delete from public.local_matter_actions where event_id = ${m.id} and matter_id like ${`${CITY}-%`}`;
    if (matters.length) {
      await tx`
        insert into public.local_matters ${tx(matters)}
        on conflict (id) do update set
          file_number = excluded.file_number, title = excluded.title, type = excluded.type,
          body = excluded.body, legistar_url = excluded.legistar_url,
          latest_action_date = excluded.latest_action_date, latest_action_text = excluded.latest_action_text,
          last_modified = excluded.last_modified`;
      await tx`delete from public.local_matter_sponsors where matter_id in ${tx(matters.map((r) => r.id as string))}`;
    }
    if (sponsors.length) await tx`insert into public.local_matter_sponsors ${tx(sponsors)}`;
    for (const c of carried)
      await tx`
        update public.local_matters
           set latest_action_date = ${date}, latest_action_text = ${c.action}, last_modified = ${`${date}T12:00:00Z`}
         where id = ${c.id} and (latest_action_date is null or latest_action_date <= ${date})`;
    if (items.length) await tx`insert into public.local_meeting_items ${tx(items)}`;
    if (actions.size)
      await tx`
        insert into public.local_matter_actions ${tx([...actions.values()])}
        on conflict (matter_id, seq) do update set
          action_date = excluded.action_date, action_name = excluded.action_name, action_text = excluded.action_text`;
  });
  return items.length;
}

/**
 * Read the council meetings' agendas, oldest first, and write their items;
 * returns the items written. Only meetings sync-worcester has stored are read.
 */
export async function loadWorcesterAgendas(sql: Sql, options: WorcesterAgendasOptions): Promise<number> {
  const {
    primegov,
    http,
    pdfText,
    force = false,
    now = () => new Date(),
    runMs = WORCESTER_AGENDAS_RUN_MINUTES * 60_000,
    minItems = WORCESTER_MIN_ITEMS,
    log = () => undefined,
  } = options;
  const warn = options.warn ?? log;
  const start = now();
  const year = start.getUTCFullYear();
  const since = options.since ?? `${year - 1}-01-01`;
  const revisable = new Date(start.getTime() - WORCESTER_REVISABLE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const stopAt = start.getTime() + runMs;

  const lists = await Promise.all([primegov.archived(year - 1), primegov.archived(year), primegov.upcoming()]);
  const meetings = [...new Map(lists.flat().map((m) => [m.id, m])).values()]
    .filter((m) => {
      const kind = worcesterMeetingKind(m.title);
      return kind.committees?.length === 0 && !kind.cancelled;
    })
    .filter((m) => m.dateTime.slice(0, 10) >= since)
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));

  const officials = await sql<{ id: string }[]>`select id from public.local_officials where city = ${CITY}`;
  const ids = new Set(officials.map((o) => o.id));
  // A full name gives the id directly (former councilors too); a surname must match one councilor.
  const officialFor = (name: string): string | null => {
    if (/\s/.test(name)) return worcesterOfficialId(name);
    const hits = [...ids].filter((id) => id.endsWith(`-${name.toLowerCase()}`));
    return hits.length === 1 ? hits[0]! : null;
  };
  const loaded = new Set(
    (
      await sql<{ meeting_id: string }[]>`
        select distinct meeting_id from public.local_meeting_items where meeting_id like ${`${CITY}-m%`}`
    ).map((r) => r.meeting_id),
  );
  const meetingRows = new Set(
    (await sql<{ id: string }[]>`select id from public.local_meetings where city = ${CITY}`).map((r) => r.id),
  );
  // Items already stored, by type and wording, so a held or tabled item keeps its matter.
  const existing: Existing = new Map(
    (
      await sql<{ id: string; type: string; title: string; agenda_date: string }[]>`
        select id, type, title, agenda_date::text from public.local_matters where city = ${CITY} order by agenda_date`
    ).map((r) => [key(r.type, r.title), r]),
  );

  let read = 0;
  let skipped = 0;
  let written = 0;
  for (const m of meetings) {
    // Oldest first, so a carried item keeps its first matter; what is left waits for the next run.
    if (now().getTime() > stopAt) {
      log(`Stopping at ${Math.round(runMs / 60_000)} minutes; the next run continues from ${m.dateTime.slice(0, 10)}.`);
      break;
    }
    const date = m.dateTime.slice(0, 10);
    const meetingId = `${CITY}-m${m.id}`;
    if (!meetingRows.has(meetingId)) continue; // sync-worcester hasn't stored it yet
    if (!force && loaded.has(meetingId) && date < revisable) continue;
    const agenda = await readAgenda(primegov, http, pdfText, m);
    if (!agenda) continue;
    read++;
    if (agenda.items.length < minItems) {
      skipped++;
      warn(`${date}: only ${agenda.items.length} items read from ${agenda.url}; skipped`);
      continue;
    }
    written += await writeAgenda(sql, m, date, meetingId, agenda, existing, officialFor);
    log(`${date}: ${agenda.items.length} items`);
  }
  log(JSON.stringify({ meetings: meetings.length, read, skipped, written }));
  // Every agenda too short to be real: the layout has changed, not the council.
  if (read > 0 && skipped === read) throw new Error(`Every agenda read (${read}) parsed as too short`);
  return written;
}
