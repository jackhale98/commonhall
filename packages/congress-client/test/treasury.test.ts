import { describe, expect, it } from 'vitest';
import { ShapeError } from '../src/shape.ts';
import { FiscalDataClient } from '../src/treasury.ts';
import { fixtureJson, json, noSleep, replayFetch } from './helpers.ts';

const latest = fixtureJson('treasury/mts9-latest.json');
const statement = fixtureJson<{ data: Record<string, unknown>[] }>('treasury/mts9-2026-09-30.json');

describe('FiscalDataClient', () => {
  it('reads the newest statement date', async () => {
    const fetch = replayFetch([{ match: (u) => u.pathname.endsWith('/mts_table_9'), respond: () => json(latest) }]);
    const client = new FiscalDataClient({ fetch, sleep: noSleep });
    expect(await client.latestMtsDate()).toBe('2026-09-30');
    const url = fetch.calls[0]!;
    expect(url.host).toBe('api.fiscaldata.treasury.gov');
    expect(url.searchParams.get('fields')).toBe('record_date');
    expect(url.searchParams.get('sort')).toBe('-record_date');
  });

  it('reads one statement’s Table 9 by date', async () => {
    const fetch = replayFetch([{ match: (u) => u.pathname.endsWith('/mts_table_9'), respond: () => json(statement) }]);
    const lines = await new FiscalDataClient({ fetch, sleep: noSleep }).mtsTable9('2026-09-30');
    expect(lines).toHaveLength(33);
    expect(fetch.calls[0]!.searchParams.get('filter')).toBe('record_date:eq:2026-09-30');
    const individual = lines.find((l) => l.classification_desc === 'Individual Income Taxes')!;
    expect(individual.current_fytd_rcpt_outly_amt).toBe('2845526866159.55');
    expect(individual.sequence_number_cd).toBe('1.1');
  });

  it('fails when the table comes back renamed or cut short', async () => {
    const renamed = { data: statement.data.map(({ current_fytd_rcpt_outly_amt: _, ...r }) => r) };
    const client = (body: unknown) =>
      new FiscalDataClient({ fetch: replayFetch([{ match: () => true, respond: () => json(body) }]), sleep: noSleep });
    await expect(client(renamed).mtsTable9('2026-09-30')).rejects.toBeInstanceOf(ShapeError);
    await expect(
      client({ data: statement.data.slice(0, 5), meta: { 'total-count': 33 } }).mtsTable9('2026-09-30'),
    ).rejects.toThrow(/33 lines, only 5/);
    await expect(client(statement).mtsTable9('2026-9-30')).rejects.toThrow(/Not a statement date/);
  });
});
