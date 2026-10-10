import { describe, expect, it } from 'vitest';
import { CivicClerkClient, civicClerkLocal, civicClerkText } from '../src/civicclerk.ts';
import { ShapeError } from '../src/shape.ts';
import { fixture, json, noSleep, replayFetch } from './helpers.ts';

function client(routes: Record<string, unknown> = {}) {
  const fetch = replayFetch([
    {
      match: (u) => u.pathname === '/v1/EventCategories',
      respond: () => json(routes.categories ?? JSON.parse(fixture('civicclerk/categories.json'))),
    },
    {
      match: (u) => u.pathname === '/v1/Events',
      respond: (u) =>
        json(
          routes.events ??
            JSON.parse(fixture(`civicclerk/events-${u.searchParams.get('$skiptoken') === 'page2' ? 2 : 1}.json`)),
        ),
    },
    {
      match: (u) => u.pathname === '/v1/Meetings/2916',
      respond: () => json(routes.meeting ?? JSON.parse(fixture('civicclerk/meeting-2916.json'))),
    },
  ]);
  return { fetch, civicclerk: new CivicClerkClient({ fetch, sleep: noSleep }) };
}

describe('CivicClerkClient', () => {
  it('lists the boards', async () => {
    const cats = await client().civicclerk.categories();
    expect(cats.find((c) => c.categoryDesc === 'City Council')?.id).toBe(26);
    expect(cats.length).toBeGreaterThan(50);
  });

  it('follows the server’s pages and filters by board and date', async () => {
    const { fetch, civicclerk } = client();
    const events = await civicclerk.events({ categories: [26, 53], since: '2026-08-01' });
    expect(events).toHaveLength(15);
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls[0]!.searchParams.get('$filter')).toBe(
      '(categoryId eq 26 or categoryId eq 53) and startDateTime ge 2026-08-01T00:00:00Z',
    );
    expect(fetch.calls[0]!.searchParams.get('$orderby')).toBe('startDateTime');
    expect(events.map((e) => e.categoryName)).toContain('Ordinance Committee');
    const withAgenda = events.find((e) => e.id === 4765)!;
    expect(withAgenda.agendaId).toBe(2916);
    expect(withAgenda.publishedFiles.map((f) => f.type)).toEqual(['Agenda', 'Agenda Packet', 'Minutes']);
  });

  it('sends a browser-like user agent (the API turns some scripted ones away)', async () => {
    const seen: string[] = [];
    const civicclerk = new CivicClerkClient({
      fetch: async (_url, init) => {
        seen.push(new Headers(init?.headers).get('user-agent') ?? '');
        return json({ value: [] });
      },
    });
    await civicclerk.categories();
    expect(seen[0]).toMatch(/^Mozilla\/5\.0/);
  });

  it('reads an agenda’s sections and items', async () => {
    const meeting = await client().civicclerk.meeting(2916);
    const consent = meeting.items.find((s) => s.agendaObjectItemName === 'Consent Agenda')!;
    expect(consent.childItems?.[0]?.agendaObjectItemNumber).toBe('2026-2404');
  });

  it('fails on a renamed field', async () => {
    const events = JSON.parse(fixture('civicclerk/events-2.json')) as { value: Record<string, unknown>[] };
    for (const e of events.value) {
      e.eventStart = e.startDateTime;
      delete e.startDateTime;
    }
    await expect(client({ events }).civicclerk.events()).rejects.toThrow(ShapeError);
  });

  it('links files and meeting pages', () => {
    const civicclerk = new CivicClerkClient();
    expect(civicclerk.fileUrl(13374)).toBe(
      'https://bristolct.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=13374,plainText=false)',
    );
    expect(civicclerk.eventUrl(4765)).toBe('https://bristolct.portal.civicclerk.com/event/4765/overview');
  });
});

describe('CivicClerk text and times', () => {
  it('strips the HTML some items carry', () => {
    expect(
      civicClerkText(
        '<strong data-pasted="true">Ordinance Committee -&nbsp;</strong><span>To adopt&nbsp;amendments</span>',
      ),
    ).toBe('Ordinance Committee - To adopt amendments');
  });

  it('reads start times as the city’s own clock', () => {
    expect(civicClerkLocal('2026-10-13T19:00:00Z')).toEqual({ date: '2026-10-13', time: '7:00 PM' });
    expect(civicClerkLocal('2026-09-03T18:30:00Z')).toEqual({ date: '2026-09-03', time: '6:30 PM' });
    expect(civicClerkLocal('2026-09-03T00:00:00Z')).toEqual({ date: '2026-09-03', time: null });
  });
});
