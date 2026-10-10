/**
 * Load the items on Worcester City Council agendas (orders, resolutions, petitions,
 * City Manager communications, committee reports, hearings, ordinances) into the
 * council matters, from PrimeGov: the HTML agenda where there is one (meetings
 * before mid-2026), else the agenda PDF read with `pdftotext -layout`.
 *
 * Each item is a matter (`ma-worcester-{meeting id × 1000 + position}`), shown as
 * "Item 12a, Oct 6, 2026", with what the council was asked to do as its latest
 * action and its sponsors matched to councilors. An item held or tabled from an
 * earlier meeting (same type and wording) keeps its first matter, so it has one
 * page and one discussion. Outcomes are in the minutes PDFs and are not read yet.
 *
 * The "Load Worcester agendas" workflow runs this daily; meetings already loaded
 * are read again only while they are recent (agendas get revised).
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-worcester-agendas.ts [--since 2025-01-01] [--force]
 *
 * Needs `pdftotext` (poppler-utils).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import {
  PrimeGovClient,
  classifyAgendaItem,
  parseAgendaHtml,
  parseAgendaText,
  worcesterMeetingKind,
  worcesterOfficialId,
  type AgendaItem,
  type PrimeGovMeeting,
} from '@civic/congress-client';

const CITY = 'ma-worcester';
const USER_AGENT = 'commonhall (+https://github.com/jackhale98/commonhall)';
/** Types that are held, tabled or carried to later meetings with the same wording. */
const CARRIED = new Set(['Order', 'Resolution', 'Ordinance', 'City Manager communication', 'Communication']);
/** Meetings this recent are read again each run. */
const REVISABLE_DAYS = 14;
const MIN_ITEMS = 10;

const key = (type: string, title: string) => `${type}|${title.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 300)}`;
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

function pdfText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'agenda-'));
  try {
    const file = join(dir, 'agenda.pdf');
    writeFileSync(file, pdf);
    return execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response;
}

/** The agenda's items and where they came from, or null when the meeting has no agenda yet. */
async function readAgenda(
  primegov: PrimeGovClient,
  m: PrimeGovMeeting,
): Promise<{ items: AgendaItem[]; url: string } | null> {
  const html = m.documentList.find((d) => /^html? agenda$/i.test(d.templateName.trim()) && d.compileOutputType === 3);
  if (html) {
    const url = primegov.documentUrl(html);
    return { items: parseAgendaHtml(await (await get(url)).text()), url };
  }
  const pdf = m.documentList.find((d) => /^agenda$/i.test(d.templateName.trim()));
  if (!pdf) return null;
  const url = primegov.documentUrl(pdf);
  return { items: parseAgendaText(pdfText(Buffer.from(await (await get(url)).arrayBuffer()))), url };
}

async function main() {
  const { values } = parseArgs({ options: { since: { type: 'string' }, force: { type: 'boolean', default: false } } });
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Set SUPABASE_DB_URL');
  const sql = postgres(url, { max: 2, prepare: false, onnotice: () => undefined });
  const primegov = new PrimeGovClient();
  const year = new Date().getUTCFullYear();
  const since = values.since ?? `${year - 1}-01-01`;
  const revisable = new Date(Date.now() - REVISABLE_DAYS * 86_400_000).toISOString().slice(0, 10);
  try {
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
    const existing = new Map(
      (
        await sql<{ id: string; type: string; title: string; agenda_date: string }[]>`
          select id, type, title, agenda_date::text from public.local_matters where city = ${CITY} order by agenda_date`
      ).map((r) => [key(r.type, r.title), r]),
    );

    let read = 0;
    let written = 0;
    for (const m of meetings) {
      const date = m.dateTime.slice(0, 10);
      const meetingId = `${CITY}-m${m.id}`;
      if (!meetingRows.has(meetingId)) continue; // sync-worcester hasn't stored it yet
      if (!values.force && loaded.has(meetingId) && date < revisable) continue;
      const agenda = await readAgenda(primegov, m);
      if (!agenda) continue;
      read++;
      if (agenda.items.length < MIN_ITEMS) {
        console.warn(`${date}: only ${agenda.items.length} items read from ${agenda.url}; skipped`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx`delete from public.local_meeting_items where meeting_id = ${meetingId}`;
        await tx`delete from public.local_matter_actions where event_id = ${m.id} and matter_id like ${`${CITY}-%`}`;
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
            await tx`
              update public.local_matters
                 set latest_action_date = ${date}, latest_action_text = ${action}, last_modified = ${`${date}T12:00:00Z`}
               where id = ${id} and (latest_action_date is null or latest_action_date <= ${date})`;
          } else {
            const row = {
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
            };
            await tx`
              insert into public.local_matters ${tx(row)}
              on conflict (id) do update set
                file_number = excluded.file_number, title = excluded.title, type = excluded.type,
                body = excluded.body, legistar_url = excluded.legistar_url,
                latest_action_date = excluded.latest_action_date, latest_action_text = excluded.latest_action_text,
                last_modified = excluded.last_modified`;
            existing.set(key(c.type, c.title), { id, type: c.type, title: c.title, agenda_date: date });
            const sponsors = [
              ...new Map(c.sponsors.map((name) => [officialFor(name), name] as const).filter(([oid]) => oid !== null)),
            ];
            await tx`delete from public.local_matter_sponsors where matter_id = ${id}`;
            if (sponsors.length)
              await tx`insert into public.local_matter_sponsors ${tx(
                sponsors.map(([official_id, name], i) => ({
                  matter_id: id,
                  official_id: official_id!,
                  name,
                  sequence: i + 1,
                })),
              )}`;
          }
          await tx`
            insert into public.local_meeting_items ${tx({ meeting_id: meetingId, seq, matter_id: id, file_number: item.number, title: c.title })}`;
          // Each appearance on an agenda is an action, so a carried item shows its history.
          await tx`
            insert into public.local_matter_actions ${tx({
              matter_id: id,
              seq: m.id,
              action_date: date,
              action_name: item.action ?? 'On the agenda',
              action_text: `Item ${item.number} on the City Council agenda`,
              body: 'City Council',
              passed: null,
              event_id: m.id,
            })}
            on conflict (matter_id, seq) do update set
              action_date = excluded.action_date, action_name = excluded.action_name, action_text = excluded.action_text`;
          written++;
        }
      });
      console.log(`${date}: ${agenda.items.length} items`);
    }
    console.log(JSON.stringify({ meetings: meetings.length, read, written }));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
