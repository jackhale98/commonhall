import { describe, expect, it } from 'vitest';
import { AnalyzeBostonClient, datastoreResource } from '../src/analyze-boston.ts';
import { fixtureJson, json, noSleep, replayFetch } from './helpers.ts';

describe('AnalyzeBostonClient', () => {
  it('finds a dataset and its datastore table', async () => {
    const fetch = replayFetch([
      {
        match: (u) => u.pathname.endsWith('/package_show'),
        respond: () => json(fixtureJson('analyze-boston/capital-package.json')),
      },
    ]);
    const client = new AnalyzeBostonClient({ fetch, sleep: noSleep });
    const pkg = await client.packageShow('capital-budget');
    expect(fetch.calls[0]!.searchParams.get('id')).toBe('capital-budget');
    expect(datastoreResource(pkg)).toMatchObject({ id: 'c62d666e-27ea-4c03-9cb1-d3a81a1fb641', format: 'CSV' });
  });

  it('pages through a datastore table', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ _id: i + 1 }));
    const fetch = replayFetch([
      {
        match: (u) => u.pathname.endsWith('/datastore_search'),
        respond: (u) => {
          const offset = Number(u.searchParams.get('offset'));
          const limit = Number(u.searchParams.get('limit'));
          return json({ success: true, result: { records: rows.slice(offset, offset + limit), total: rows.length } });
        },
      },
    ]);
    const client = new AnalyzeBostonClient({ fetch, sleep: noSleep });
    const seen: unknown[] = [];
    for await (const r of client.all('abc', { pageSize: 2 })) seen.push(r);
    expect(seen).toHaveLength(5);
    expect(fetch.calls.map((u) => u.searchParams.get('offset'))).toEqual(['0', '2', '4']);
  });

  it('sends SQL as a query parameter and reports CKAN errors', async () => {
    const fetch = replayFetch([
      {
        match: (u) => u.pathname.endsWith('/datastore_search_sql'),
        respond: (u) =>
          u.searchParams.get('sql')!.includes('bad')
            ? json({ success: false, error: { message: 'Not authorized to call function extract' } })
            : json({ success: true, result: { records: [{ n: 3 }] } }),
      },
    ]);
    const client = new AnalyzeBostonClient({ fetch, sleep: noSleep });
    expect(await client.sql('select count(*) as n from "x"')).toEqual([{ n: 3 }]);
    await expect(client.sql('select bad')).rejects.toThrow(/Not authorized/);
  });
});
