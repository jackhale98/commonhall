import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpClient, PrimeGovClient, type PrimeGovMeeting } from '@civic/congress-client';
import { loadWorcesterAgendas, type WorcesterAgendasOptions } from '@civic/sync/loaders';
import type { Sql } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
const CITY = 'ma-worcester';

async function clean() {
  // Matters cascade to their sponsors and actions; meetings to their items.
  await sql`delete from public.local_matters where city = ${CITY}`;
  await sql`delete from public.local_meetings where city = ${CITY}`;
  await sql`delete from public.local_officials where city = ${CITY}`;
}
beforeEach(clean);
afterAll(async () => {
  await clean();
  await sql.end();
});

const fixture = (name: string) =>
  readFileSync(new URL(`../../packages/congress-client/test/fixtures/worcester/${name}`, import.meta.url), 'utf8');

const HTML_AGENDA = fixture('agenda-2026-01-13.html');
const PDF_AGENDA = fixture('agenda-2026-10-06.txt');

/** City Council meetings in the recorded lists: Jan 13 and Jan 20 (HTML agendas), Oct 13 (a PDF agenda). */
const JAN_13 = 12673;
const JAN_20 = 12674;
const OCT_13 = 12834;

/**
 * PrimeGov as recorded. Agenda documents are served by template id (others are 404s,
 * through a real HttpClient so its status check applies); the PDF holds its URL and
 * `pdfText` gives the recorded Oct 6 agenda text.
 */
function fakePrimeGov(documents: Record<number, string>) {
  const primegov = new PrimeGovClient();
  const archived = JSON.parse(fixture('archived-2026.json')) as PrimeGovMeeting[];
  primegov.archived = async (year: number) => (year === 2026 ? archived : []);
  primegov.upcoming = async () => JSON.parse(fixture('upcoming.json')) as PrimeGovMeeting[];
  const fetched: string[] = [];
  const http = new HttpClient({
    maxAttempts: 1,
    fetch: async (url) => {
      fetched.push(url);
      const templateId = Number(new URL(url).searchParams.get('meetingTemplateId'));
      const body = documents[templateId];
      return body === undefined ? new Response('not found', { status: 404 }) : new Response(body);
    },
  });
  const pdfText = (pdf: Uint8Array, options?: { layout?: boolean }) => {
    expect(options?.layout).toBe(true);
    return new TextDecoder().decode(pdf) === 'pdf' ? PDF_AGENDA : '';
  };
  return { primegov, http, pdfText, fetched };
}

/** The recorded agendas: Jan 13's HTML (also served as Jan 20's, so its items carry over) and Oct 13's PDF. */
const AGENDAS = { 75801: HTML_AGENDA, 75805: HTML_AGENDA, 76844: 'pdf' };

/** Long after the meetings, so none is recent enough to be read again. */
const LATER = () => new Date('2026-11-30T12:00:00Z');

function load(site: ReturnType<typeof fakePrimeGov>, options: Partial<WorcesterAgendasOptions> = {}) {
  return loadWorcesterAgendas(sql, {
    primegov: site.primegov,
    http: site.http,
    pdfText: site.pdfText,
    now: LATER,
    ...options,
  });
}

/** The meeting rows sync-worcester would have stored, and some councilors for sponsors' surnames. */
async function seed(meetings: number[]) {
  await sql`
    insert into public.local_meetings ${sql(
      meetings.map((id) => ({
        id: `${CITY}-m${id}`,
        city: CITY,
        event_id: id,
        body: 'City Council',
        date: '2026-01-01',
      })),
    )}`;
  await sql`
    insert into public.local_officials ${sql(
      ['jose-rivera', 'gary-rosen', 'robert-bilotta'].map((slug, i) => ({
        id: `${CITY}-${slug}`,
        city: CITY,
        person_id: i + 1,
        name: slug,
      })),
    )}`;
}

const count = async (query: Promise<{ n: number }[]>) => (await query)[0]!.n;
const itemsOf = (id: number) =>
  sql<{ seq: number; matter_id: string; file_number: string }[]>`
    select seq, matter_id, file_number from public.local_meeting_items where meeting_id = ${`${CITY}-m${id}`} order by seq`;

describe('Load Worcester agendas', () => {
  it('writes matters, items and sponsors from HTML and PDF agendas, and nothing on a quiet rerun', async () => {
    await seed([JAN_13, OCT_13]);
    const site = fakePrimeGov(AGENDAS);
    const written = await load(site);
    // Only meetings sync-worcester stored are read (not Jan 20's).
    expect(site.fetched).toHaveLength(2);
    expect(site.fetched[0]).toMatch(/Portal\/Meeting\?meetingTemplateId=75801$/);
    expect(site.fetched[1]).toMatch(/CompiledDocument\?meetingTemplateId=76844&compileOutputType=1$/);

    const jan = await itemsOf(JAN_13);
    const oct = await itemsOf(OCT_13);
    expect(jan.length).toBeGreaterThan(100);
    expect(oct.length).toBeGreaterThan(100);
    expect(written).toBe(jan.length + oct.length);
    // Each new item's matter id is the meeting id × 1000 + its position on the agenda.
    expect(jan.every((i) => i.matter_id === `${CITY}-${JAN_13 * 1000 + i.seq}`)).toBe(true);

    const [matter] = await sql<
      { file_number: string; agenda_date: string; latest_action_text: string; legistar_url: string }[]
    >`
      select file_number, agenda_date::text, latest_action_text, legistar_url
        from public.local_matters where id = ${jan[0]!.matter_id}`;
    expect(matter!.file_number).toBe(`${jan[0]!.file_number}, Jan 13, 2026`);
    expect(matter!.agenda_date).toBe('2026-01-13');
    expect(matter!.latest_action_text).toMatch(/^On the agenda/);
    expect(matter!.legistar_url).toMatch(/meetingTemplateId=75801/);

    // A full name gives the id directly; a surname is matched to the one councilor with it.
    const sponsors = await sql<{ official_id: string; name: string }[]>`
      select s.official_id, s.name from public.local_matter_sponsors s
        join public.local_matters m on m.id = s.matter_id where m.city = ${CITY}`;
    expect(sponsors.some((s) => s.official_id === `${CITY}-khrystian-king` && s.name === 'Khrystian E. King')).toBe(
      true,
    );
    expect(sponsors.some((s) => s.official_id === `${CITY}-gary-rosen` && s.name === 'Rosen')).toBe(true);
    // Surnames with no councilor stored (King's surname alone) are left out.
    expect(sponsors.some((s) => s.name === 'King')).toBe(false);

    const actions = await count(sql`
      select count(*)::int as n from public.local_matter_actions where matter_id like ${`${CITY}-%`}`);
    const matters = await count(sql`select count(*)::int as n from public.local_matters where city = ${CITY}`);

    const again = fakePrimeGov(AGENDAS);
    expect(await load(again)).toBe(0);
    expect(again.fetched).toHaveLength(0);
    expect(await count(sql`select count(*)::int as n from public.local_matters where city = ${CITY}`)).toBe(matters);
    expect(
      await count(sql`
        select count(*)::int as n from public.local_matter_actions where matter_id like ${`${CITY}-%`}`),
    ).toBe(actions);
  });

  it('keeps the first matter for an item carried to a later meeting', async () => {
    await seed([JAN_13, JAN_20]);
    await load(fakePrimeGov(AGENDAS));
    const first = await itemsOf(JAN_13);
    const later = await itemsOf(JAN_20);
    expect(later).toHaveLength(first.length);

    const types = new Map(
      (await sql<{ id: string; type: string }[]>`select id, type from public.local_matters where city = ${CITY}`).map(
        (r) => [r.id, r.type],
      ),
    );
    const carriedTypes = ['Order', 'Resolution', 'Ordinance', 'City Manager communication', 'Communication'];
    const order = first.find((i) => types.get(i.matter_id) === 'Order')!;
    const petition = first.find((i) => types.get(i.matter_id) === 'Petition')!;
    // An order held over keeps its Jan 13 matter; a petition is a new one each time.
    expect(later.find((i) => i.seq === order.seq)!.matter_id).toBe(order.matter_id);
    expect(later.find((i) => i.seq === petition.seq)!.matter_id).toBe(`${CITY}-${JAN_20 * 1000 + petition.seq}`);
    for (const item of later) {
      const firstId = first.find((i) => i.seq === item.seq)!.matter_id;
      if (carriedTypes.includes(types.get(firstId)!)) expect(item.matter_id).toBe(firstId);
      else expect(item.matter_id).toBe(`${CITY}-${JAN_20 * 1000 + item.seq}`);
    }

    // The carried matter keeps its first label and date, with the later meeting as its latest action.
    const [matter] = await sql<{ file_number: string; agenda_date: string; latest_action_date: string }[]>`
      select file_number, agenda_date::text, latest_action_date::text from public.local_matters where id = ${order.matter_id}`;
    expect(matter).toEqual({
      file_number: `${order.file_number}, Jan 13, 2026`,
      agenda_date: '2026-01-13',
      latest_action_date: '2026-01-20',
    });
    const actions = await sql<{ seq: number; action_date: string }[]>`
      select seq, action_date::text from public.local_matter_actions where matter_id = ${order.matter_id} order by seq`;
    expect(actions).toEqual([
      { seq: JAN_13, action_date: '2026-01-13' },
      { seq: JAN_20, action_date: '2026-01-20' },
    ]);
  });

  it('refuses when every agenda reads too short (a changed layout), writing nothing', async () => {
    await seed([JAN_13]);
    const short = HTML_AGENDA.split('\n').slice(0, 8).join('\n');
    const warnings: string[] = [];
    await expect(load(fakePrimeGov({ 75801: short }), { warn: (message) => warnings.push(message) })).rejects.toThrow(
      /Every agenda read \(1\) parsed as too short/,
    );
    expect(warnings).toEqual([expect.stringMatching(/^2026-01-13: only \d items read from .*; skipped$/)]);
    expect(await count(sql`select count(*)::int as n from public.local_matters where city = ${CITY}`)).toBe(0);
  });

  it('fails on an agenda document that is not there', async () => {
    await seed([JAN_13]);
    await expect(load(fakePrimeGov({}))).rejects.toThrow(/HTTP 404/);
  });

  it('stops reading at the time limit, leaving the rest for the next run', async () => {
    await seed([JAN_13, JAN_20]);
    let minutes = 0;
    // Each look at the clock is a minute later; the limit allows one agenda.
    const now = () => new Date(Date.parse('2026-11-30T12:00:00Z') + minutes++ * 60_000);
    const logs: string[] = [];
    const site = fakePrimeGov(AGENDAS);
    const written = await load(site, { now, runMs: 90_000, log: (message) => logs.push(message) });
    expect(site.fetched).toHaveLength(1);
    expect(written).toBe((await itemsOf(JAN_13)).length);
    expect(await itemsOf(JAN_20)).toHaveLength(0);
    expect(logs).toContain('Stopping at 2 minutes; the next run continues from 2026-01-20.');
  });
});
