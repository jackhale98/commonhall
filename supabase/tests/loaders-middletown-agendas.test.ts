import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MIDDLETOWN_COUNCIL_URL } from '@civic/congress-client';
import { loadMiddletownAgendas } from '@civic/sync/loaders';
import type { Sql } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
const CITY = 'ct-middletown';

async function clean() {
  // Items and actions go with their meetings and matters (on delete cascade).
  await sql`delete from public.local_meetings where city = ${CITY}`;
  await sql`delete from public.local_matters where city = ${CITY}`;
  await sql`delete from public.local_officials where city = ${CITY}`;
}
beforeEach(clean);
afterAll(async () => {
  await clean();
  await sql.end();
});

const fixture = (name: string) =>
  readFileSync(new URL(`../../packages/congress-client/test/fixtures/connecticut/${name}`, import.meta.url), 'utf8');

/** 1 December 2026: every posting in the recorded listing is past the two-week re-read window. */
const DEC_1 = () => Date.UTC(2026, 11, 1);

/**
 * middletownct.gov as recorded: the council page, the 2026 listing (2025's is empty) and
 * agendas served as fake PDFs holding their posting number, read by a fake pdfText.
 * Postings 11628 (Aug 20, special) and 11755 (Oct 5, regular) have recorded agendas;
 * Sep 8's regular meeting (11674, not recorded) is served Aug 20's, so its items are
 * carried; the rest (Questions to Directors, a community meeting) read as nothing.
 * `agendas` replaces any of these.
 */
function fakeSite(agendas: Record<number, string> = {}, council = fixture('middletown-council.html')) {
  const read: number[] = [];
  const texts: Record<number, string> = {
    11628: fixture('middletown-agenda-2026-08-20.txt'),
    11674: fixture('middletown-agenda-2026-08-20.txt'),
    11755: fixture('middletown-agenda-2026-10-05.txt'),
    ...agendas,
  };
  const http = {
    get: async (url: string) => {
      if (url === MIDDLETOWN_COUNCIL_URL) return new Response(council);
      const id = /\/ViewFile\/Agenda\/_\d{8}-(\d+)$/.exec(url)?.[1];
      if (!id) return new Response('missing', { status: 404 });
      return new Response(new TextEncoder().encode(`%PDF-${id}`));
    },
    post: async (_url: string, body: string) => {
      const year = new URLSearchParams(body).get('year');
      return new Response(year === '2026' ? fixture('middletown-agenda-list.html') : '<table></table>');
    },
  };
  const pdfText = (pdf: Uint8Array) => {
    const id = Number(new TextDecoder().decode(pdf).slice(5));
    read.push(id);
    return texts[id] ?? '';
  };
  return { http, pdfText, read };
}

const count = async (query: Promise<unknown>) => ((await query) as unknown as [{ n: number }])[0].n;
const counts = async () => ({
  officials: await count(sql`select count(*)::int as n from public.local_officials where city = ${CITY} and current`),
  meetings: await count(sql`select count(*)::int as n from public.local_meetings where city = ${CITY}`),
  matters: await count(sql`select count(*)::int as n from public.local_matters where city = ${CITY}`),
  items: await count(
    sql`select count(*)::int as n from public.local_meeting_items i join public.local_meetings m on m.id = i.meeting_id
         where m.city = ${CITY}`,
  ),
  actions: await count(
    sql`select count(*)::int as n from public.local_matter_actions where matter_id like ${`${CITY}-%`}`,
  ),
});

describe('Load Middletown agendas', () => {
  it('loads members, meetings and matters, and reads nothing again on a quiet rerun', async () => {
    const site = fakeSite();
    const warnings: string[] = [];
    const written = await loadMiddletownAgendas(sql, {
      http: site.http as never,
      pdfText: site.pdfText,
      now: DEC_1,
      warn: (m) => warnings.push(m),
    });
    // Oldest first; every posting's agenda is read once.
    expect(site.read).toEqual([11628, 11658, 11674, 11745, 11755, 11747]);
    expect(warnings).toEqual([]);
    const after = await counts();
    // Aug 20's five matters (carried on Sep 8) and Oct 5's twelve.
    expect(after).toEqual({ officials: expect.any(Number), meetings: 6, matters: 17, items: 22, actions: 22 });
    expect(after.officials).toBeGreaterThanOrEqual(10);
    expect(written).toBe(after.officials + after.meetings + after.items);

    const [meeting] = await sql<{ time: string | null; minutes_url: string | null; body: string }[]>`
      select time, minutes_url, body from public.local_meetings where id = 'ct-middletown-m11755'`;
    expect(meeting).toEqual({ time: '7:00 PM', minutes_url: null, body: 'Common Council' });
    const matters = await sql<{ id: string; file_number: string; type: string; agenda_date: string }[]>`
      select id, file_number, type, agenda_date::text from public.local_matters
       where city = ${CITY} and agenda_date = '2026-10-05' order by matter_id`;
    expect(matters).toHaveLength(12);
    expect(matters[0]).toMatchObject({ file_number: 'Item 7A, Oct 5, 2026', type: 'Appropriation' });
    expect(matters.every((m) => /^ct-middletown-11755\d{3}$/.test(m.id))).toBe(true);
    const [action] = await sql<{ action_text: string; event_id: number }[]>`
      select action_text, event_id from public.local_matter_actions where matter_id = ${matters[0]!.id}`;
    expect(action).toEqual({ action_text: 'Item 7A on the Regular Meeting agenda', event_id: 11755 });

    // An item carried to a later meeting keeps its first matter and gains an action.
    const sep8 = await sql<{ matter_id: string }[]>`
      select matter_id from public.local_meeting_items where meeting_id = 'ct-middletown-m11674'`;
    expect(sep8).toHaveLength(5);
    expect(sep8.every((i) => /^ct-middletown-11628\d{3}$/.test(i.matter_id))).toBe(true);
    const [carried] = await sql<{ agenda_date: string; latest_action_date: string; actions: number }[]>`
      select m.agenda_date::text, m.latest_action_date::text,
             (select count(*)::int from public.local_matter_actions a where a.matter_id = m.id) as actions
        from public.local_matters m where m.id = ${sep8[0]!.matter_id}`;
    expect(carried).toEqual({ agenda_date: '2026-08-20', latest_action_date: '2026-09-08', actions: 2 });

    // Nothing is new: no agenda is read again, and no rows are added or changed.
    const snapshot = () =>
      sql`select id, title, latest_action_date::text, latest_action_text from public.local_matters
           where city = ${CITY} order by id`;
    const before = await snapshot();
    const again = fakeSite();
    const rewritten = await loadMiddletownAgendas(sql, {
      http: again.http as never,
      pdfText: again.pdfText,
      now: DEC_1,
    });
    expect(again.read).toEqual([]);
    // The listed meetings are upserted again and counted as written; members are unchanged.
    expect(rewritten).toBe(after.meetings);
    expect(await counts()).toEqual(after);
    expect(await snapshot()).toEqual(before);
  });

  it('reads recent postings again, and every posting with force', async () => {
    const first = fakeSite();
    await loadMiddletownAgendas(sql, { http: first.http as never, pdfText: first.pdfText, now: DEC_1 });
    // On 15 October the two-week window reaches back to 1 October.
    const recent = fakeSite();
    await loadMiddletownAgendas(sql, {
      http: recent.http as never,
      pdfText: recent.pdfText,
      now: () => Date.UTC(2026, 9, 15),
    });
    expect(recent.read).toEqual([11745, 11755, 11747]);
    const forced = fakeSite();
    await loadMiddletownAgendas(sql, { http: forced.http as never, pdfText: forced.pdfText, now: DEC_1, force: true });
    expect(forced.read).toEqual([11628, 11658, 11674, 11745, 11755, 11747]);
    // Rereading an agenda replaces its items rather than adding to them.
    expect(await counts()).toMatchObject({ meetings: 6, matters: 17, items: 22, actions: 22 });
  });

  it('skips a short regular agenda without storing its meeting, so the next run tries again', async () => {
    const site = fakeSite({ 11674: '' });
    const warnings: string[] = [];
    await loadMiddletownAgendas(sql, {
      http: site.http as never,
      pdfText: site.pdfText,
      now: DEC_1,
      warn: (m) => warnings.push(m),
    });
    expect(warnings).toEqual([expect.stringMatching(/^2026-09-08: only 0 items read from .*-11674; skipped$/)]);
    expect(await counts()).toMatchObject({ meetings: 5, matters: 17, items: 17 });
  });

  it('fails when every regular agenda reads as too short (a changed layout)', async () => {
    const site = fakeSite({ 11674: '', 11755: 'AGENDA\nWelcome\nThe council will discuss the budget.\n' });
    await expect(
      loadMiddletownAgendas(sql, { http: site.http as never, pdfText: site.pdfText, now: DEC_1 }),
    ).rejects.toThrow('Every regular agenda read (2) parsed as too short');
    // Neither regular meeting is stored; only the special meeting's matters are.
    const after = await counts();
    expect(after.matters).toBe(5);
    expect(
      await count(
        sql`select count(*)::int as n from public.local_meetings where id in ('ct-middletown-m11674', 'ct-middletown-m11755')`,
      ),
    ).toBe(0);
  });

  it('fails before writing when the council page reads as too few members', async () => {
    const site = fakeSite({}, '<html><body><h1>Common Council</h1></body></html>');
    await expect(
      loadMiddletownAgendas(sql, { http: site.http as never, pdfText: site.pdfText, now: DEC_1 }),
    ).rejects.toThrow(/read as 0 members/);
    expect(await counts()).toEqual({ officials: 0, meetings: 0, matters: 0, items: 0, actions: 0 });
    expect(site.read).toEqual([]);
  });
});
