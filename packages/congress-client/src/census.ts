/**
 * Census Geocoder (https://geocoding.geo.census.gov). No key required.
 *
 * Gotcha: the default `Current_Current` vintage switches to the *next* Congress's
 * district lines as soon as the Census publishes them (in late 2026 it returns
 * "120th Congressional Districts", reflecting mid-decade redistricting), while
 * the sitting House was elected on the previous lines. We therefore look for the
 * layer named for the Congress we want and fall back through older vintages.
 */
import { HttpClient, type HttpOptions } from './http.ts';

export const CENSUS_BASE = 'https://geocoding.geo.census.gov/geocoder';

const FALLBACK_VINTAGES = ['Current_Current', 'ACS2025_Current', 'ACS2024_Current', 'ACS2023_Current'];

export interface CensusDistricts {
  stateFips: string | null;
  /** Two-letter postal code. */
  state: string | null;
  /** 0 for at-large seats and non-voting delegates. Null if the layer was missing. */
  congressionalDistrict: number | null;
  congress: number | null;
  stateUpper: string | null;
  stateLower: string | null;
}

export interface GeocodeResult extends CensusDistricts {
  matchedAddress: string;
  lat: number;
  lng: number;
}

type Geographies = Record<string, Record<string, unknown>[]>;

interface CensusResponse {
  result?: {
    addressMatches?: {
      matchedAddress: string;
      coordinates: { x: number; y: number };
      addressComponents?: { state?: string };
      geographies?: Geographies;
    }[];
    geographies?: Geographies;
  };
}

export const STATE_FIPS: Record<string, string> = {
  '01': 'AL',
  '02': 'AK',
  '04': 'AZ',
  '05': 'AR',
  '06': 'CA',
  '08': 'CO',
  '09': 'CT',
  '10': 'DE',
  '11': 'DC',
  '12': 'FL',
  '13': 'GA',
  '15': 'HI',
  '16': 'ID',
  '17': 'IL',
  '18': 'IN',
  '19': 'IA',
  '20': 'KS',
  '21': 'KY',
  '22': 'LA',
  '23': 'ME',
  '24': 'MD',
  '25': 'MA',
  '26': 'MI',
  '27': 'MN',
  '28': 'MS',
  '29': 'MO',
  '30': 'MT',
  '31': 'NE',
  '32': 'NV',
  '33': 'NH',
  '34': 'NJ',
  '35': 'NM',
  '36': 'NY',
  '37': 'NC',
  '38': 'ND',
  '39': 'OH',
  '40': 'OK',
  '41': 'OR',
  '42': 'PA',
  '44': 'RI',
  '45': 'SC',
  '46': 'SD',
  '47': 'TN',
  '48': 'TX',
  '49': 'UT',
  '50': 'VT',
  '51': 'VA',
  '53': 'WA',
  '54': 'WV',
  '55': 'WI',
  '56': 'WY',
  '60': 'AS',
  '66': 'GU',
  '69': 'MP',
  '72': 'PR',
  '78': 'VI',
};

function str(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Census uses `00` for at-large and `98` for delegate districts; both map to 0. */
export function normalizeCongressionalDistrict(code: string | null): number | null {
  if (code === null) return null;
  const n = Number.parseInt(code, 10);
  if (!Number.isFinite(n)) return null;
  if (n === 0 || n === 98 || n === 99) return 0;
  return n;
}

/** Read the districts out of a `geographies` object for a specific Congress. */
export function extractDistricts(geographies: Geographies, congress: number): CensusDistricts {
  let cdLayer: Record<string, unknown> | undefined;
  let cdCongress: number | null = null;
  let upper: Record<string, unknown> | undefined;
  let lower: Record<string, unknown> | undefined;
  let stateLayer: Record<string, unknown> | undefined;

  for (const [name, features] of Object.entries(geographies)) {
    const first = features?.[0];
    if (!first) continue;
    const cd = /^(\d+)(?:st|nd|rd|th) Congressional Districts$/.exec(name);
    if (cd && Number(cd[1]) === congress) {
      cdLayer = first;
      cdCongress = Number(cd[1]);
    } else if (/State Legislative Districts - Upper$/.test(name)) upper = first;
    else if (/State Legislative Districts - Lower$/.test(name)) lower = first;
    else if (name === 'States') stateLayer = first;
  }

  const stateFips = str(cdLayer?.STATE ?? upper?.STATE ?? lower?.STATE ?? stateLayer?.STATE);
  const cdCode = cdLayer ? str(cdLayer[`CD${congress}`] ?? cdLayer.BASENAME) : null;
  const baseDistrict = (layer?: Record<string, unknown>) => (layer ? str(layer.BASENAME) : null);

  return {
    stateFips,
    state: stateFips ? (STATE_FIPS[stateFips] ?? null) : null,
    congressionalDistrict: cdLayer ? normalizeCongressionalDistrict(/^\d+$/.test(cdCode ?? '') ? cdCode : '0') : null,
    congress: cdCongress,
    stateUpper: baseDistrict(upper),
    stateLower: baseDistrict(lower),
  };
}

export class CensusGeocoder {
  readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(options: HttpOptions & { baseUrl?: string } = {}) {
    this.http = new HttpClient({ maxAttempts: 3, ...options });
    this.baseUrl = (options.baseUrl ?? CENSUS_BASE).replace(/\/$/, '');
  }

  private async fetch(path: string, params: Record<string, string>): Promise<CensusResponse> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('layers', 'all');
    url.searchParams.set('format', 'json');
    return this.http.getJson<CensusResponse>(url.toString());
  }

  /** Geocode a one-line address and return the districts for `congress`, or null if no match. */
  async geocode(address: string, congress: number): Promise<GeocodeResult | null> {
    const first = await this.fetch('/geographies/onelineaddress', { address, vintage: FALLBACK_VINTAGES[0]! });
    const match = first.result?.addressMatches?.[0];
    if (!match) return null;
    const lat = match.coordinates.y;
    const lng = match.coordinates.x;
    let districts = extractDistricts(match.geographies ?? {}, congress);

    for (const vintage of FALLBACK_VINTAGES.slice(1)) {
      if (districts.congressionalDistrict !== null) break;
      const byCoords = await this.fetch('/geographies/coordinates', { x: String(lng), y: String(lat), vintage });
      const older = extractDistricts(byCoords.result?.geographies ?? {}, congress);
      if (older.congressionalDistrict !== null) {
        // Keep the newest state-legislative lines; take only the congressional district from the older vintage.
        districts = {
          ...districts,
          congressionalDistrict: older.congressionalDistrict,
          congress: older.congress,
          state: districts.state ?? older.state,
          stateFips: districts.stateFips ?? older.stateFips,
        };
      }
    }

    return { matchedAddress: match.matchedAddress, lat, lng, ...districts };
  }
}
