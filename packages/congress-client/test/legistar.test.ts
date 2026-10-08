import { describe, expect, it } from 'vitest';
import { LegistarClient, legistarMatterUrl, legistarUtc, odataDate, type LegistarMatter } from '../src/legistar.ts';
import { fixtureJson, json, replayFetch } from './helpers.ts';

describe('Legistar helpers', () => {
  it('formats OData datetimes and normalises zone-less UTC stamps', () => {
    expect(odataDate('2026-10-05T12:13:52.107')).toBe("datetime'2026-10-05T12:13:52'");
    expect(odataDate(new Date('2026-01-01T00:00:00Z'))).toBe("datetime'2026-01-01T00:00:00'");
    expect(legistarUtc('2026-10-06T20:54:23.493')).toBe('2026-10-06T20:54:23.493Z');
    expect(legistarUtc(null)).toBeNull();
  });

  it('builds public matter links', () => {
    expect(legistarMatterUrl('boston', 43547, 'ABC')).toBe(
      'https://boston.legistar.com/LegislationDetail.aspx?ID=43547&GUID=ABC',
    );
  });
});

describe('LegistarClient with recorded Boston responses', () => {
  it('reads matters with the documented fields', async () => {
    const matters = fixtureJson<LegistarMatter[]>('legistar/matters.json');
    expect(matters[0]).toMatchObject({
      MatterId: 43547,
      MatterFile: '2026-1882',
      MatterTypeName: 'Council Legislative Resolution',
      MatterStatusName: 'Passed',
      MatterBodyName: 'City Council',
    });
  });

  it('pages past the 1,000-row cap with $skip and filters by body and modified time', async () => {
    const all = Array.from({ length: 1500 }, (_, i) => ({ MatterId: i + 1 }));
    const fetch = replayFetch([
      {
        match: (u) => u.pathname === '/v1/boston/matters',
        respond: (u) => {
          const skip = Number(u.searchParams.get('$skip') ?? 0);
          const top = Number(u.searchParams.get('$top'));
          return json(all.slice(skip, skip + top));
        },
      },
    ]);
    const client = new LegistarClient({ fetch });
    const rows = await client.mattersModifiedSince(138, '2026-10-01T00:00:00Z');
    expect(rows).toHaveLength(1500);
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls[0]!.searchParams.get('$filter')).toBe(
      "MatterBodyId eq 138 and MatterLastModifiedUtc gt datetime'2026-10-01T00:00:00'",
    );
    expect(fetch.calls[0]!.searchParams.get('$orderby')).toBe('MatterLastModifiedUtc asc');
    expect(fetch.calls[1]!.searchParams.get('$skip')).toBe('1000');
  });

  it('reads office records for seats held on a day', async () => {
    const fetch = replayFetch([
      {
        match: (u) => u.pathname === '/v1/boston/officerecords',
        respond: () => json(fixtureJson('legistar/officerecords.json')),
      },
    ]);
    const records = await new LegistarClient({ fetch }).officeRecords(138, new Date('2026-10-08T00:00:00Z'));
    expect(records).toHaveLength(13);
    expect(records.map((r) => r.OfficeRecordFullName)).toContain('Miniard Culpepper');
    expect(fetch.calls[0]!.searchParams.get('$filter')).toContain("OfficeRecordEndDate ge datetime'2026-10-08'");
  });
});
