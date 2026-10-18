import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/http.ts';
import { ShapeError } from '../src/shape.ts';
import { UsaSpendingClient, type AwardGroup } from '../src/usaspending.ts';
import { fixtureJson, json, noSleep } from './helpers.ts';

/** Answers like USAspending: the agency list, or a geography search by the layer and award types it was sent. */
function usaFetch() {
  const bodies: Record<string, unknown>[] = [];
  const groups: Record<string, AwardGroup> = { A: 'contracts', '02': 'grants', '06': 'other' };
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/api/v2/references/toptier_agencies/')
      return json(fixtureJson('usaspending/toptier-agencies.json'));
    if (url.pathname === '/api/v2/search/spending_by_geography/' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { geo_layer: string; filters: { award_type_codes: string[] } };
      bodies.push(body);
      const group = groups[body.filters.award_type_codes[0]!]!;
      return json(fixtureJson(`usaspending/geo-${body.geo_layer}-${group}.json`));
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, bodies };
}

describe('UsaSpendingClient', () => {
  it('lists agencies with their budget authority', async () => {
    const agencies = await new UsaSpendingClient({ fetch: usaFetch().fetch, sleep: noSleep }).toptierAgencies();
    expect(agencies.length).toBe(16);
    const treasury = agencies.find((a) => a.toptier_code === '020')!;
    expect(treasury.agency_name).toBe('Department of the Treasury');
    expect(treasury.budget_authority_amount).toBeGreaterThan(3e12);
    expect(treasury.active_fy).toBe('2026');
  });

  it('searches a fiscal year’s awards by state and district', async () => {
    const { fetch, bodies } = usaFetch();
    const client = new UsaSpendingClient({ fetch, sleep: noSleep });
    const states = await client.spendingByGeography('state', 2025, 'grants');
    expect(states.find((s) => s.shape_code === 'MA')!.aggregated_amount).toBeGreaterThan(1e10);
    const districts = await client.spendingByGeography('district', 2025, 'contracts');
    expect(districts.find((d) => d.display_name === 'MA-08')).toBeTruthy();
    expect(bodies[0]).toMatchObject({
      scope: 'place_of_performance',
      geo_layer: 'state',
      filters: {
        award_type_codes: ['02', '03', '04', '05'],
        time_period: [{ start_date: '2024-10-01', end_date: '2025-09-30' }],
      },
    });
    expect(bodies[1]).toMatchObject({ geo_layer: 'district', filters: { award_type_codes: ['A', 'B', 'C', 'D'] } });
  });

  it('fails when the results change shape or the layer is wrong', async () => {
    const answer = (body: unknown) =>
      new UsaSpendingClient({ fetch: async () => json(body), sleep: noSleep }).spendingByGeography(
        'state',
        2025,
        'grants',
      );
    await expect(answer({ geo_layer: 'state', results: [{ code: 'MA', amount: 1 }] })).rejects.toBeInstanceOf(
      ShapeError,
    );
    await expect(answer({ geo_layer: 'county', results: [] })).rejects.toThrow(/asked for state, got county/);
  });
});
