import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CourtListenerClient, type ClCluster } from '@civic/congress-client';
import { scotusCaseRow, supremeCourtTerm } from '../src/federal/court.ts';

const sample = JSON.parse(
  readFileSync(
    new URL('../../congress-client/test/fixtures/courtlistener/scotus-sample.json', import.meta.url),
    'utf8',
  ),
);

describe('Supreme Court', () => {
  it('maps a decision with separately listed opinions', () => {
    expect(scotusCaseRow(sample.results[0] as ClCluster)).toMatchObject({
      cluster_id: 10000001,
      case_name: 'Trump v. United States',
      docket_number: '23-939',
      date_filed: '2024-07-01',
      term: 2023,
      citations: ['603 U.S. 593'],
      url: 'https://www.courtlistener.com/opinion/10000001/trump-v-united-states/',
      dissents: 2,
      concurrences: 1,
    });
  });

  it('does not count dissents inside a combined opinion', () => {
    expect(scotusCaseRow(sample.results[1] as ClCluster)).toMatchObject({
      opinion_types: ['combined-opinion'],
      dissents: 0,
      judges: null,
    });
  });

  it('assigns October Term years', () => {
    expect(supremeCourtTerm('2025-10-06')).toBe(2025);
    expect(supremeCourtTerm('2026-06-30')).toBe(2025);
    expect(supremeCourtTerm('2026-09-30')).toBe(2025);
  });

  it('queries the Supreme Court with the token in a header, not the URL', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const client = new CourtListenerClient({
      token: 'secret-token',
      fetch: async (url, init) => {
        seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
        return new Response(JSON.stringify(sample), { headers: { 'content-type': 'application/json' } });
      },
    });
    const rows = [];
    for await (const c of client.supremeCourtOpinions('2020-10-01')) rows.push(c);
    expect(rows).toHaveLength(2);
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe('/api/rest/v4/search/');
    expect(url.searchParams.get('type')).toBe('o');
    expect(url.searchParams.get('q')).toBe('court_id:scotus AND dateFiled:[2020-10-01 TO *]');
    expect(url.searchParams.get('order_by')).toBe('dateFiled desc');
    expect(seen[0]!.url).not.toContain('secret-token');
    expect(seen[0]!.auth).toBe('Token secret-token');
  });
});
