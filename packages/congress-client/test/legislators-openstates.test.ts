import { describe, expect, it } from 'vitest';
import { lisToBioguideMap, summarizeLegislator, type Legislator } from '../src/legislators.ts';
import { OpenStatesClient, currentSession, jurisdictionToState, stateJurisdiction } from '../src/openstates.ts';
import { fixtureJson, json, replayFetch } from './helpers.ts';

describe('congress-legislators', () => {
  const legislators = fixtureJson<Legislator[]>('legislators/legislators-current.json');

  it('maps LIS ids to Bioguide ids for senators only', () => {
    const map = lisToBioguideMap(legislators);
    expect(map.get('S275')).toBe('C000127');
    expect([...map.keys()].every((k) => /^S\d+$/.test(k))).toBe(true);
  });

  it('summarises the current term', () => {
    const cantwell = summarizeLegislator(legislators.find((l) => l.id.bioguide === 'C000127')!);
    expect(cantwell).toMatchObject({
      chamber: 'senate',
      state: 'WA',
      district: null,
      lisId: 'S275',
      // ['S8WA00194', 'H2WA01054']: the Senate id, not her old House one.
      fecCandidateId: 'S8WA00194',
      nextElection: 2030,
    });
    const rep = summarizeLegislator(legislators.find((l) => l.terms.at(-1)!.type === 'rep')!);
    expect(rep?.chamber).toBe('house');
    expect(typeof rep?.district).toBe('number');
  });
});

describe('Open States helpers', () => {
  it('converts jurisdictions', () => {
    expect(jurisdictionToState('ocd-jurisdiction/country:us/state:ca/government')).toBe('CA');
    expect(jurisdictionToState('ocd-jurisdiction/country:us/district:dc/government')).toBe('DC');
    expect(stateJurisdiction('TX')).toBe('ocd-jurisdiction/country:us/state:tx/government');
  });

  it('picks the active session', () => {
    const sessions = [
      { identifier: '2023', name: '2023', classification: 'primary', start_date: '2023-01-01', end_date: '2023-12-31' },
      {
        identifier: '2025',
        name: '2025-2026',
        classification: 'primary',
        start_date: '2025-01-01',
        end_date: '2026-12-31',
      },
      {
        identifier: '2025S1',
        name: 'Special',
        classification: 'special',
        start_date: '2025-06-01',
        end_date: '2025-06-30',
      },
    ];
    expect(currentSession(sessions, new Date('2026-10-08'))?.identifier).toBe('2025');
    expect(currentSession(sessions.slice(0, 1), new Date('2026-10-08'))?.identifier).toBe('2023');
  });

  it('sends the key as a header and spaces requests', async () => {
    const seenHeaders: string[] = [];
    const waits: number[] = [];
    const fetch = replayFetch([
      {
        match: () => true,
        respond: () => json({ results: [], pagination: { page: 1, max_page: 1, per_page: 20, total_items: 0 } }),
      },
    ]);
    const wrapped = async (input: string, init?: RequestInit) => {
      seenHeaders.push(new Headers(init?.headers).get('x-api-key') ?? '');
      return fetch(input, init);
    };
    const client = new OpenStatesClient({
      apiKey: 'os-key',
      fetch: wrapped,
      minIntervalMs: 500,
      sleep: async (ms) => void waits.push(ms),
    });
    await client.bills({ jurisdiction: 'ca', session: '20252026', updatedSince: '2026-10-01' });
    await client.bills({ jurisdiction: 'ca', session: '20252026', page: 2 });
    expect(seenHeaders).toEqual(['os-key', 'os-key']);
    expect(waits).toHaveLength(1);
    const url = fetch.calls[0]!;
    expect(url.pathname).toBe('/bills');
    expect(url.searchParams.get('include')).toBe('sponsorships');
    expect(url.searchParams.get('updated_since')).toBe('2026-10-01');
    expect(url.search).not.toContain('os-key');
  });
});
