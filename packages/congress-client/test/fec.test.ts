import { describe, expect, it } from 'vitest';
import { FecClient, fecTwoYearPeriod, isOrganisationEmployer } from '../src/fec.ts';
import { RequestBudget } from '../src/http.ts';
import { fixture, replayFetch } from './helpers.ts';

const json = (path: string) => () =>
  new Response(fixture(`fec/${path}`), { headers: { 'content-type': 'application/json' } });

function client() {
  const fetch = replayFetch([
    { match: (u) => u.pathname.endsWith('/candidate/S2MA00170/totals/'), respond: json('totals-warren.json') },
    { match: (u) => u.pathname.endsWith('/candidate/S2MA00170/committees/'), respond: json('committees-warren.json') },
    { match: (u) => u.pathname.endsWith('/schedule_a/by_employer/'), respond: json('employer-warren.json') },
    { match: (u) => u.pathname.endsWith('/by_size/by_candidate/'), respond: json('size-sample.json') },
    { match: (u) => u.pathname.endsWith('/by_state/by_candidate/'), respond: json('state-sample.json') },
    { match: (u) => u.pathname.endsWith('/schedules/schedule_a/'), respond: json('committee-receipts-sample.json') },
  ]);
  return { fec: new FecClient({ apiKey: 'test', fetch, budget: new RequestBudget(100, 'fec') }), fetch };
}

describe('FecClient', () => {
  it('reads whole-campaign totals with election_full and the key', async () => {
    const { fec, fetch } = client();
    const totals = await fec.candidateTotals('S2MA00170', 2030);
    expect(totals).toMatchObject({
      candidate_id: 'S2MA00170',
      receipts: 4413931.4,
      last_cash_on_hand_end_period: 3754333.02,
    });
    const url = fetch.calls[0]!;
    expect(url.searchParams.get('election_full')).toBe('true');
    expect(url.searchParams.get('cycle')).toBe('2030');
    expect(url.searchParams.get('api_key')).toBe('test');
  });

  it('finds the principal committee and groups donors by employer', async () => {
    const { fec, fetch } = client();
    const committee = await fec.principalCommittee('S2MA00170');
    expect(committee).toMatchObject({ committee_id: 'C00500843', name: 'WARREN FOR SENATE, INC.' });
    const employers = await fec.byEmployer('C00500843', 2026);
    expect(employers[0]).toMatchObject({ employer: 'NONE' });
    expect(fetch.calls[0]!.searchParams.get('designation')).toBe('P');
    expect(fetch.calls[1]!.searchParams.get('sort')).toBe('-total');
  });

  it('asks only for PAC contributions (Form 3 line 11C), largest first', async () => {
    const { fec, fetch } = client();
    await fec.pacContributions('C00500843', 2026);
    const url = fetch.calls[0]!;
    expect(url.searchParams.get('line_number')).toBe('F3-11C');
    expect(url.searchParams.get('two_year_transaction_period')).toBe('2026');
    expect(url.searchParams.get('sort')).toBe('-contribution_receipt_amount');
  });

  it('knows the current two-year period and which employers are organisations', () => {
    expect(fecTwoYearPeriod(new Date('2025-03-01'))).toBe(2026);
    expect(fecTwoYearPeriod(new Date('2026-10-09'))).toBe(2026);
    for (const e of ['NONE', 'Retired', 'SELF-EMPLOYED', 'Self Employed', 'N/A', 'INFORMATION REQUESTED', '', null]) {
      expect(isOrganisationEmployer(e)).toBe(false);
    }
    expect(isOrganisationEmployer('MIT/HARVARD')).toBe(true);
  });
});
