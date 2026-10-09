import { describe, expect, it } from 'vitest';
import { FecClient, RequestBudget, type FetchLike } from '@civic/congress-client';
import { fetchFinance } from '../src/federal/finance.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../congress-client/test/fixtures/fec/${name}`, import.meta.url)), 'utf8');

const fetch: FetchLike = async (input) => {
  const path = new URL(input).pathname;
  const file = path.endsWith('/totals/')
    ? 'totals-warren.json'
    : path.endsWith('/committees/')
      ? 'committees-warren.json'
      : path.endsWith('/by_employer/')
        ? 'employer-warren.json'
        : path.endsWith('/by_size/by_candidate/')
          ? 'size-sample.json'
          : path.endsWith('/by_state/by_candidate/')
            ? 'state-sample.json'
            : 'committee-receipts-sample.json';
  return new Response(fixture(file), { headers: { 'content-type': 'application/json' } });
};

describe('campaign finance summary', () => {
  it('turns six FEC responses into one row of aggregates', async () => {
    const budget = new RequestBudget(10, 'fec');
    const row = await fetchFinance(
      new FecClient({ apiKey: 'test', fetch, budget }),
      { bioguide_id: 'W000817', state: 'MA', fec_candidate_id: 'S2MA00170', next_election: 2030 },
      new Date('2026-10-09T00:00:00Z'),
    );
    expect(budget.used).toBe(6);
    expect(row).toMatchObject({
      member_id: 'W000817',
      committee_id: 'C00500843',
      election_year: 2030,
      period: 2026,
      receipts: 4413931.4,
      cash_on_hand: 3754333.02,
      individual_small: 2861352.85,
      individual_large: 1373252.85,
      pacs: 20000,
      self_funding: 0,
      coverage_end: '2026-06-30',
      in_state: 402000.5,
      out_of_state: 501200,
    });
    // "NONE", "SELF EMPLOYED" and "RETIRED" describe the donor, not an organisation.
    expect(row!.top_employers.map((e) => e.name).slice(0, 2)).toEqual(['ALSOP LOUIE PARTNERS', 'TEI']);
    // PAC contributions are summed per committee; candidate-committee transfers (CCM) are left out.
    expect(row!.top_committees).toEqual([
      { name: 'EXAMPLE NURSES PAC', id: 'C00000001', total: 7500, type: 'PAC' },
      { name: 'EXAMPLE STATE PARTY', id: 'C00000002', total: 4000, type: 'PTY' },
      { name: 'EXAMPLE TEACHERS PAC', id: null, total: 1000, type: 'PAC' },
    ]);
    expect(row!.by_size.map((s) => s.size)).toEqual([0, 200, 500, 1000, 2000]);
    expect(row!.top_states[0]).toEqual({ state: 'MA', total: 402000.5 });
  });
});
