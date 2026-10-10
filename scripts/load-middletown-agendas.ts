/**
 * Load Middletown, Connecticut's Common Council from the city's website: its members
 * (the Common Council page) and its meetings and agenda items (the Agenda Center).
 * Agendas are PDFs, read with `pdftotext -layout`; an Edge Function can't run poppler,
 * so this is a daily GitHub Action like Worcester's agenda loader (§87).
 *
 *  - Members: replaced when the page reads as at least ten members (twelve seats).
 *  - Meetings: every Common Council posting this year and last (regular and special
 *    meetings, Questions to Directors, workshops), with the agenda and minutes links.
 *  - Matters: the items under Resolutions and Ordinances, Old Business and
 *    Appropriations, as `ct-middletown-{posting × 1000 + position}`, cited as
 *    "Item 11A, Oct 5, 2026", or by number where the agenda gives one ("Resolution
 *    No. 81-26"). An item carried to a later meeting (same number, or same type and
 *    wording) keeps its first matter and gains an action. Outcomes and roll calls are
 *    in the minutes, which we link and don't read yet.
 *
 * Postings already loaded are read again only while recent (agendas get amended).
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-middletown-agendas.ts [--since 2025-01-01] [--force] [--minutes 18]
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
  MIDDLETOWN_AGENDA_CENTER,
  MIDDLETOWN_COUNCIL_CATEGORY,
  MIDDLETOWN_COUNCIL_URL,
  classifyMiddletownItem,
  parseAgendaCenterList,
  parseMiddletownAgenda,
  parseMiddletownCouncil,
  type AgendaPosting,
  type MiddletownItem,
} from '@civic/congress-client';
import { meetingStart, storeCouncilors, type Sql } from '@civic/sync';
import { recordRun } from './lib/record-run.ts';

const CITY = 'ct-middletown';
const BODY = 'Common Council';
const USER_AGENT = 'Mozilla/5.0 (compatible; commonhall/1.0; +https://github.com/jackhale98/commonhall)';
const MIN_MEMBERS = 10;
/** Postings this recent are read again each run. */
const REVISABLE_DAYS = 14;
/** A regular meeting's agenda has a few dozen lettered items; fewer means the layout changed. */
const MIN_ITEMS = 8;

const key = (type: string, title: string) => `${type}|${title.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 300)}`;
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

async function fetchOk(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      ...init,
      headers: { 'user-agent': USER_AGENT, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(60_000),
    }).catch((error: unknown) => error as Error);
    if (response instanceof Response && response.ok) return response;
    const retry = !(response instanceof Response) || response.status === 429 || response.status >= 500;
    if (!retry || attempt >= 3)
      throw new Error(`${url}: ${response instanceof Response ? response.status : response.message}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

/** An agenda as text: most are PDFs; some are posted as plain text or HTML from the Agenda Creator. */
function agendaText(body: Buffer): string {
  if (body.subarray(0, 5).toString('latin1') !== '%PDF-')
    return body
      .toString('utf8')
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  return pdfText(body);
}

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

/** The Common Council's postings for a year. */
async function postings(year: number): Promise<AgendaPosting[]> {
  const response = await fetchOk(`${MIDDLETOWN_AGENDA_CENTER}/UpdateCategoryList`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ year: String(year), catID: String(MIDDLETOWN_COUNCIL_CATEGORY) }).toString(),
  });
  return parseAgendaCenterList(await response.text());
}

type Existing = Map<string, { id: string; agenda_date: string }>;

/** Write one meeting's agenda items: they replace its earlier ones; carried items move their matter's latest action. */
async function writeAgenda(
  sql: postgres.Sql,
  p: AgendaPosting,
  meetingId: string,
  items: MiddletownItem[],
  existing: Existing,
): Promise<number> {
  const matters: Record<string, unknown>[] = [];
  const carried: { id: string; action: string }[] = [];
  const rows: Record<string, unknown>[] = [];
  const actions = new Map<string, Record<string, unknown>>();
  let seq = 0;
  for (const item of items) {
    seq++;
    const c = classifyMiddletownItem(item, items);
    if (!c) continue;
    const action = `On the agenda: ${c.section}`;
    const keys = [...(c.number ? [`no|${c.number}`] : []), key(c.type, c.title)];
    const prior = keys.map((k) => existing.get(k)).find(Boolean);
    const own = `${CITY}-${p.id * 1000 + seq}`;
    const id = prior && prior.agenda_date < p.date ? prior.id : own;
    if (id !== own) carried.push({ id, action });
    else {
      matters.push({
        id,
        city: CITY,
        matter_id: p.id * 1000 + seq,
        file_number: c.number ?? `Item ${item.number}, ${shortDate(p.date)}`,
        title: c.title,
        type: c.type,
        status: null,
        body: c.section,
        intro_date: p.date,
        agenda_date: p.date,
        passed_date: null,
        legistar_url: p.agendaUrl,
        last_modified: `${p.date}T12:00:00Z`,
        latest_action_date: p.date,
        latest_action_text: action,
      });
      for (const k of keys) existing.set(k, { id, agenda_date: p.date });
    }
    rows.push({ meeting_id: meetingId, seq, matter_id: id, file_number: item.number, title: c.title });
    actions.set(id, {
      matter_id: id,
      seq: p.id,
      action_date: p.date,
      action_name: 'On the agenda',
      action_text: `Item ${item.number} on the ${p.title.replace(/^common council\s*[-:–]?\s*/i, '') || BODY} agenda`,
      body: BODY,
      passed: null,
      event_id: p.id,
    });
  }
  await sql.begin(async (tx) => {
    await tx`delete from public.local_meeting_items where meeting_id = ${meetingId}`;
    await tx`delete from public.local_matter_actions where event_id = ${p.id} and matter_id like ${`${CITY}-%`}`;
    if (matters.length)
      await tx`
        insert into public.local_matters ${tx(matters)}
        on conflict (id) do update set
          file_number = excluded.file_number, title = excluded.title, type = excluded.type,
          body = excluded.body, legistar_url = excluded.legistar_url,
          latest_action_date = excluded.latest_action_date, latest_action_text = excluded.latest_action_text,
          last_modified = excluded.last_modified`;
    for (const c of carried)
      await tx`
        update public.local_matters
           set latest_action_date = ${p.date}, latest_action_text = ${c.action}, last_modified = ${`${p.date}T12:00:00Z`}
         where id = ${c.id} and (latest_action_date is null or latest_action_date <= ${p.date})`;
    if (rows.length) await tx`insert into public.local_meeting_items ${tx(rows)}`;
    if (actions.size)
      await tx`
        insert into public.local_matter_actions ${tx([...actions.values()])}
        on conflict (matter_id, seq) do update set
          action_date = excluded.action_date, action_name = excluded.action_name, action_text = excluded.action_text`;
  });
  return rows.length;
}

async function main() {
  const { values } = parseArgs({
    options: {
      since: { type: 'string' },
      force: { type: 'boolean', default: false },
      minutes: { type: 'string', default: '18' },
    },
  });
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Set SUPABASE_DB_URL');
  const runMinutes = Number(values.minutes);
  const sql = postgres(url, { max: 2, prepare: false, onnotice: () => undefined });
  const year = new Date().getUTCFullYear();
  const since = values.since ?? `${year - 1}-01-01`;
  const revisable = new Date(Date.now() - REVISABLE_DAYS * 86_400_000).toISOString().slice(0, 10);
  try {
    await recordRun(sql, 'load-middletown-agendas', runMinutes + 10, async () => {
      let written = 0;
      const members = parseMiddletownCouncil(await (await fetchOk(MIDDLETOWN_COUNCIL_URL)).text());
      if (members.length < MIN_MEMBERS)
        throw new Error(`Middletown council page read as ${members.length} members; has its layout changed?`);
      written += await storeCouncilors(sql as unknown as Sql, CITY, members);
      console.log(`${members.length} council members`);

      // A posting listed twice (the listing repeats some) is kept once.
      const all = new Map<number, AgendaPosting>();
      for (let y = Number(since.slice(0, 4)); y <= year; y++)
        for (const p of await postings(y)) if (!all.has(p.id)) all.set(p.id, p);
      const listed = [...all.values()]
        .filter((p) => p.date >= since && /common council/i.test(p.title))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      if (all.size >= 10 && listed.length === 0)
        throw new Error(`None of ${all.size} postings is a Common Council meeting; has the listing changed?`);

      const known = new Map(
        (
          await sql<
            { id: string; time: string | null }[]
          >`select id, time from public.local_meetings where city = ${CITY}`
        ).map((r) => [r.id, r.time]),
      );
      // Items already stored, by number and by type and wording, so a carried item keeps its matter.
      const existing: Existing = new Map();
      for (const r of await sql<
        { id: string; type: string; title: string; file_number: string; agenda_date: string }[]
      >`
        select id, type, title, file_number, agenda_date::text from public.local_matters
         where city = ${CITY} order by agenda_date`) {
        existing.set(key(r.type, r.title), r);
        if (/ No\. /.test(r.file_number)) existing.set(`no|${r.file_number}`, r);
      }

      let read = 0;
      let regularRead = 0;
      let short = 0;
      const stopAt = Date.now() + runMinutes * 60_000;
      for (const p of listed) {
        // Oldest first, so a carried item keeps its first matter; what is left waits for the next run.
        if (Date.now() > stopAt) {
          console.log(`Stopping at ${runMinutes} minutes; the next run continues from ${p.date}.`);
          break;
        }
        const meetingId = `${CITY}-m${p.id}`;
        const reread = values.force || !known.has(meetingId) || p.date >= revisable;
        let time = known.get(meetingId) ?? null;
        let items: MiddletownItem[] | null = null;
        if (reread) {
          const agenda = parseMiddletownAgenda(
            agendaText(Buffer.from(await (await fetchOk(p.agendaUrl)).arrayBuffer())),
          );
          time = agenda.time;
          items = agenda.items;
          read++;
          // Regular meetings have long agendas; a short one means the PDF's layout has changed.
          // The meeting isn't stored, so the next run tries again.
          if (/regular/i.test(p.title)) {
            regularRead++;
            if (items.length < MIN_ITEMS) {
              short++;
              console.warn(`${p.date}: only ${items.length} items read from ${p.agendaUrl}; skipped`);
              continue;
            }
          }
        }
        const row = {
          id: meetingId,
          city: CITY,
          event_id: p.id,
          body: BODY,
          starts_at: meetingStart(p.date, time),
          date: p.date,
          time,
          location: null,
          agenda_url: p.agendaUrl,
          minutes_url: p.minutesUrl,
          legistar_url: MIDDLETOWN_AGENDA_CENTER,
          status: /cancel/i.test(p.title) ? 'Cancelled' : null,
          committees: [] as string[],
        };
        await sql`
          insert into public.local_meetings ${sql(row)}
          on conflict (id) do update set
            date = excluded.date, time = excluded.time, starts_at = excluded.starts_at,
            agenda_url = excluded.agenda_url, minutes_url = excluded.minutes_url, status = excluded.status`;
        written++;
        if (!items) continue;
        const n = await writeAgenda(sql, p, meetingId, items, existing);
        written += n;
        console.log(`${p.date} ${p.title}: ${items.length} items, ${n} matters`);
      }
      console.log(JSON.stringify({ postings: listed.length, read, regularRead, short, written }));
      // Every regular agenda too short to be real: the layout has changed, not the council.
      if (regularRead > 0 && short === regularRead)
        throw new Error(`Every regular agenda read (${regularRead}) parsed as too short`);
      return written;
    });
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
