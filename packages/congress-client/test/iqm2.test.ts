import { describe, expect, it } from 'vitest';
import {
  Iqm2Client,
  flattenOutline,
  monthDayYear,
  parseLegiFile,
  parseResult,
  type Iqm2MeetingListing,
  type Iqm2Outline,
} from '../src/iqm2.ts';
import { ShapeError } from '../src/shape.ts';
import { fixture, json, noSleep, replayFetch } from './helpers.ts';

const cambridge = (name: string) => fixture(`cambridge/${name}`);

function client() {
  const fetch = replayFetch([
    {
      match: (u) => u.pathname === '/api/Meeting/ListWithMeetingType',
      respond: () => json(JSON.parse(cambridge('iqm2-meetings.json')) as Iqm2MeetingListing[]),
    },
    {
      match: (u) => u.pathname === '/api/Meeting/4768/Outline',
      respond: () => json(JSON.parse(cambridge('iqm2-outline.json')) as Iqm2Outline),
    },
    {
      match: (u) => u.pathname === '/api/MeetingDoc/31555',
      respond: () => json(JSON.parse(cambridge('iqm2-doc.json'))),
    },
    {
      match: (u) => u.pathname === '/api/Department/1000/Members',
      respond: () => json(JSON.parse(cambridge('iqm2-members.json'))),
    },
    {
      match: (u) => u.pathname === '/Citizens/Detail_LegiFile.aspx',
      respond: (u) => new Response(cambridge(`iqm2-legifile-${u.searchParams.get('ID')}.html`)),
    },
  ]);
  return { fetch, iqm2: new Iqm2Client({ client: 'cambridgema', fetch, sleep: noSleep }) };
}

describe('Iqm2Client', () => {
  it('lists a body’s meetings for a year', async () => {
    const { iqm2, fetch } = client();
    const rows = await iqm2.meetings(2025, 1000);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.Meeting).toMatchObject({ ID: 4769, Status: 'Cancelled', Department: { Name: 'City Council' } });
    expect(rows[1]!.Agenda?.ID).toBe(4354);
    expect(fetch.calls[0]!.host).toBe('cambridgema.iqm2.com');
    expect(fetch.calls[0]!.searchParams.get('Range')).toBe('2025');
    expect(fetch.calls[0]!.searchParams.get('Group')).toBe('1000');
  });

  it('reads an agenda tree and finds the legislative files in it', async () => {
    const { iqm2 } = client();
    const outline = await iqm2.outline(4768);
    const files = flattenOutline(outline.Agenda!.Outline).filter((i) => i.ReferencedItem?.Type === 'Resolution');
    expect(files[0]).toMatchObject({ Title: 'CMA 2025 #305 : 12.22.25 Federal Update', ReferencedItem: { ID: 31623 } });
    expect(files.map((f) => f.Title.split(' : ')[0])).toContain('POR 2025 #172');
  });

  it('reads a legislative file and the council’s members', async () => {
    const { iqm2 } = client();
    expect(await iqm2.meetingDoc(31555)).toMatchObject({ FormalNumber: 'POR 2025 #171', Status: 'Completed' });
    const members = await iqm2.members(1000);
    expect(members).toHaveLength(9);
    expect(members.find((m) => m.Title === 'Mayor')?.FullName).toBe('Sumbul Siddiqui');
  });

  it('fails loudly when a field it reads is renamed', async () => {
    const fetch = async () => json([{ Meeting: { Id: 1, When: '2025-01-01' } }]);
    const iqm2 = new Iqm2Client({ fetch, sleep: noSleep });
    await expect(iqm2.meetings(2025, 1000)).rejects.toBeInstanceOf(ShapeError);
    const members = new Iqm2Client({ fetch: async () => json([{ Name: 'x' }]), sleep: noSleep });
    await expect(members.members(1000)).rejects.toBeInstanceOf(ShapeError);
  });
});

describe('legislative file pages', () => {
  it('reads sponsors, each meeting’s result and a split roll call', async () => {
    const { iqm2 } = client();
    const file = await iqm2.legiFile(31555);
    expect(file).toMatchObject({
      number: 'POR 2025 #171',
      fileType: 'Policy Order',
      status: 'FAILED OF ADOPTION',
      sponsors: ['Councillor Patricia Nolan', 'Councillor Catherine Zusy', 'Councillor Ayesha M. Wilson'],
    });
    expect(file.title).toMatch(/^That the City Manager is requested to instruct/);
    expect(file.history).toHaveLength(2);
    expect(file.history[0]).toMatchObject({ meetingId: 4767, date: '2025-12-15', vote: { result: 'CHARTER RIGHT' } });
    expect(file.history[1]).toMatchObject({
      meetingId: 4768,
      date: '2025-12-22',
      body: 'City Council',
      comments: 'FINALIZED IN COUNCIL DECEMBER 22, 2025',
      vote: { result: 'FAILED OF ADOPTION', yes: 4, no: 5 },
    });
    expect(file.history[1]!.vote!.yeas).toEqual([
      'Patricia Nolan',
      'Sumbul Siddiqui',
      'Ayesha M. Wilson',
      'Catherine Zusy',
    ]);
    expect(file.history[1]!.vote!.nays).toHaveLength(5);
  });

  it('reads a unanimous vote with its names and no sponsors', () => {
    const file = parseLegiFile(cambridge('iqm2-legifile-31623.html'), 31623);
    expect(file.sponsors).toEqual([]);
    expect(file.history[0]!.vote).toMatchObject({ result: 'PLACED ON FILE', unanimous: true, yes: null });
    expect(file.history[0]!.vote!.yeas).toHaveLength(9);
  });

  it('refuses a page without a file number', () => {
    expect(() => parseLegiFile('<html><body>Maintenance</body></html>', 1)).toThrow(ShapeError);
  });

  it('reads tallies and dates in either form', () => {
    expect(parseResult('ORDER ADOPTED [8 TO 0]')).toMatchObject({ result: 'ORDER ADOPTED', yes: 8, no: 0 });
    expect(parseResult('Adopted as Amended [8-0-0-1]')).toMatchObject({ yes: 8, no: 0 });
    expect(parseResult('Adopted [VV9]')).toMatchObject({ result: 'Adopted', yes: null });
    expect(monthDayYear('Dec 22, 2025 5:30 PM')).toBe('2025-12-22');
    expect(monthDayYear('OCTOBER 05, 2026')).toBe('2026-10-05');
  });
});
