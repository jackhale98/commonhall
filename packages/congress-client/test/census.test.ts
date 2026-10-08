import { describe, expect, it } from 'vitest';
import { CensusGeocoder, extractDistricts, normalizeCongressionalDistrict } from '../src/census.ts';
import { fixtureJson, json, replayFetch } from './helpers.ts';

type Geo = {
  result: {
    addressMatches: { geographies: Record<string, Record<string, unknown>[]> }[];
    geographies?: Record<string, Record<string, unknown>[]>;
  };
};

describe('extractDistricts', () => {
  it('ignores the next Congress layer (Current vintage in Austin shows the 120th lines)', () => {
    const austin = fixtureJson<Geo>('census/austin-current.json');
    const g = austin.result.addressMatches[0]!.geographies;
    expect(extractDistricts(g, 120)).toMatchObject({ state: 'TX', congressionalDistrict: 10, congress: 120 });
    expect(extractDistricts(g, 119)).toMatchObject({
      state: 'TX',
      congressionalDistrict: null,
      stateUpper: '14',
      stateLower: '49',
    });
  });

  it('reads the 119th district from an older vintage', () => {
    const coords = fixtureJson<Geo>('census/austin-acs2025-coords.json');
    expect(extractDistricts(coords.result.geographies!, 119)).toMatchObject({
      state: 'TX',
      congressionalDistrict: 37,
      congress: 119,
    });
  });

  it('maps the DC delegate district to 0', () => {
    const dc = fixtureJson<Geo>('census/whitehouse-current.json');
    expect(extractDistricts(dc.result.addressMatches[0]!.geographies, 120)).toMatchObject({
      state: 'DC',
      congressionalDistrict: 0,
    });
  });

  it('normalises at-large codes', () => {
    expect(normalizeCongressionalDistrict('00')).toBe(0);
    expect(normalizeCongressionalDistrict('98')).toBe(0);
    expect(normalizeCongressionalDistrict('07')).toBe(7);
    expect(normalizeCongressionalDistrict(null)).toBeNull();
  });
});

describe('CensusGeocoder', () => {
  it('falls back to an older vintage for the sitting Congress', async () => {
    const fetch = replayFetch([
      {
        match: (u) => u.pathname.endsWith('/onelineaddress'),
        respond: () => json(fixtureJson('census/austin-current.json')),
      },
      {
        match: (u) => u.pathname.endsWith('/coordinates') && u.searchParams.get('vintage') === 'ACS2025_Current',
        respond: () => json(fixtureJson('census/austin-acs2025-coords.json')),
      },
    ]);
    const result = await new CensusGeocoder({ fetch }).geocode('1100 Congress Ave, Austin, TX 78701', 119);
    expect(result).toMatchObject({
      state: 'TX',
      congressionalDistrict: 37,
      congress: 119,
      stateUpper: '14',
      stateLower: '49',
    });
    expect(result!.lat).toBeCloseTo(30.276, 2);
    expect(fetch.calls).toHaveLength(2);
  });

  it('returns null when nothing matches', async () => {
    const fetch = replayFetch([{ match: () => true, respond: () => json({ result: { addressMatches: [] } }) }]);
    expect(await new CensusGeocoder({ fetch }).geocode('nowhere', 119)).toBeNull();
  });
});
