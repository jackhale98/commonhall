/**
 * Find my reps: address → Census geocoder (districts for the sitting Congress)
 * → senators and House member from our `members` table → state legislators from
 * Open States `people.geo` by coordinates (cached by coordinates rounded to
 * ~100 m, upserted into state_legislators so they can be followed).
 *
 * Addresses are never stored or logged.
 */
import {
  RequestBudget,
  jurisdictionToState,
  type CensusGeocoder,
  type GeocodeResult,
  type OpenStatesClient,
} from '@civic/congress-client';
import { upsertIfChanged, type Sql } from '../db.ts';
import { stateLegislatorRow } from './sync-state.ts';

export const GEO_API = 'openstates-geo';
export const GEO_HOURLY_CAP = 120;

export interface FederalRep {
  bioguide_id: string;
  name: string;
  party: string | null;
  state: string | null;
  district: number | null;
  chamber: 'house' | 'senate' | null;
  photo_url: string | null;
  website: string | null;
  phone: string | null;
}

export interface StateRep {
  id: string;
  name: string;
  party: string | null;
  state: string;
  chamber: string | null;
  district: string | null;
  title: string | null;
  photo_url: string | null;
  openstates_url: string | null;
}

export interface LocalRep {
  id: string;
  name: string;
  seat: string | null;
  district: number | null;
  email: string | null;
  photo_url: string | null;
}

export interface RepsResult {
  matchedAddress: string;
  /** City with local data ("boston", "worcester") when the address is inside it. */
  city: string | null;
  councilDistrict: number | null;
  /** District councilor first, then at-large councilors. */
  localOfficials: LocalRep[];
  state: string | null;
  congress: number;
  congressionalDistrict: number | null;
  stateUpper: string | null;
  stateLower: string | null;
  federal: FederalRep[];
  stateLegislators: StateRep[];
  stateSource: 'openstates' | 'database' | 'none';
}

const FEDERAL_COLUMNS = 'bioguide_id, name, party, state, district, chamber, photo_url, website, phone';

export async function federalReps(sql: Sql, state: string, district: number | null): Promise<FederalRep[]> {
  return sql.unsafe<FederalRep[]>(
    `select ${FEDERAL_COLUMNS} from public.members
      where current and state = $1
        and (chamber = 'senate' or (chamber = 'house' and $2::smallint is not null and district = $2::smallint))
      order by chamber desc, name`,
    [state, district],
  );
}

/** Census pads districts ("014"); Open States does not ("14"). */
export function normalizeDistrict(value: string | null): string | null {
  if (!value) return null;
  return /^\d+$/.test(value) ? String(Number(value)) : value;
}

const STATE_COLUMNS = 'id, name, party, state, chamber, district, title, photo_url, openstates_url';

async function stateRepsFromDatabase(sql: Sql, geo: GeocodeResult): Promise<StateRep[]> {
  if (!geo.state) return [];
  return sql.unsafe<StateRep[]>(
    `select ${STATE_COLUMNS} from public.state_legislators
      where current and state = $1
        and ((chamber = 'upper' and district = $2) or (chamber = 'lower' and district = $3)
             or (chamber = 'legislature' and district in ($2, $3)))
      order by chamber desc, name`,
    [geo.state, normalizeDistrict(geo.stateUpper), normalizeDistrict(geo.stateLower)],
  );
}

async function stateRepsFromOpenStates(
  sql: Sql,
  client: OpenStatesClient,
  geo: GeocodeResult,
): Promise<StateRep[] | null> {
  const key = `people:${geo.lat.toFixed(3)},${geo.lng.toFixed(3)}`;
  const [hit] = await sql<{ payload: StateRep[] }[]>`
    select payload from public.geo_cache where key = ${key} and expires_at > now()`;
  if (hit) return hit.payload;

  const [usage] = await sql<{ used: number }[]>`select public.api_usage_this_hour(${GEO_API}) as used`;
  if ((usage?.used ?? 0) >= GEO_HOURLY_CAP) return null;

  try {
    const result = await client.peopleGeo(geo.lat, geo.lng);
    const rows = result.results
      .filter(
        (p) => p.jurisdiction?.classification === 'state' || jurisdictionToState(p.jurisdiction?.id ?? '') === 'DC',
      )
      .map(stateLegislatorRow)
      .filter((r): r is Record<string, unknown> => r !== null);
    await sql.begin(async (tx) => {
      for (const row of rows) await upsertIfChanged(tx, 'public.state_legislators', ['id'], row);
      await tx`
        insert into public.geo_cache (key, payload, expires_at)
        values (${key}, ${tx.json(rows as never)}, now() + interval '30 days')
        on conflict (key) do update set payload = excluded.payload, expires_at = excluded.expires_at`;
    });
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      party: (r.party as string | null) ?? null,
      state: r.state as string,
      chamber: (r.chamber as string | null) ?? null,
      district: (r.district as string | null) ?? null,
      title: (r.title as string | null) ?? null,
      photo_url: (r.photo_url as string | null) ?? null,
      openstates_url: (r.openstates_url as string | null) ?? null,
    }));
  } finally {
    if (client.budget.used > 0) {
      await sql`select public.record_api_usage(${GEO_API}, ${client.budget.used})`;
      await sql`select public.record_api_usage('openstates', ${client.budget.used})`;
    }
  }
}

/**
 * The district councilor, then the at-large councilors. District 0 is a city's whole
 * boundary, for cities elected at-large or without a district map yet: every councilor.
 */
export async function localReps(sql: Sql, city: string, district: number): Promise<LocalRep[]> {
  return sql<LocalRep[]>`
    select id, name, seat, district, email, photo_url from public.local_officials
     where city = ${city} and current and (${district} = 0 or district = ${district} or seat = 'At-Large')
     order by (district is null), district, name`;
}

export interface FindRepsDeps {
  census: CensusGeocoder;
  /** Builds an Open States client with the given request budget; omit to use the database only. */
  openstates?: (budget: RequestBudget) => OpenStatesClient;
}

export async function findReps(
  sql: Sql,
  deps: FindRepsDeps,
  address: string,
  congress: number,
): Promise<RepsResult | null> {
  const geo = await deps.census.geocode(address, congress);
  if (!geo) return null;
  const federal = geo.state ? await federalReps(sql, geo.state, geo.congressionalDistrict) : [];

  let stateLegislators: StateRep[] = [];
  let stateSource: RepsResult['stateSource'] = 'none';
  if (deps.openstates && geo.state) {
    try {
      const fromApi = await stateRepsFromOpenStates(sql, deps.openstates(new RequestBudget(2, 'openstates')), geo);
      if (fromApi) {
        stateLegislators = fromApi;
        stateSource = 'openstates';
      }
    } catch {
      // Fall back to district matching below.
    }
  }
  if (stateSource === 'none' && geo.state) {
    stateLegislators = await stateRepsFromDatabase(sql, geo);
    if (stateLegislators.length > 0) stateSource = 'database';
  }

  // Cities we cover: point-in-polygon against their council district maps (a district
  // before a city's whole boundary, district 0, where a city has both).
  let city: string | null = null;
  let councilDistrict: number | null = null;
  let localOfficials: LocalRep[] = [];
  {
    const [row] = await sql<{ city: string; district: number }[]>`
      select d.city, d.district from public.council_districts d
       where extensions.st_contains(d.geometry, extensions.st_setsrid(extensions.st_point(${geo.lng}, ${geo.lat}), 4326))
       order by (d.district = 0), d.district
       limit 1`;
    if (row) {
      city = row.city;
      councilDistrict = row.district;
      localOfficials = await localReps(sql, city, councilDistrict);
    }
  }

  return {
    matchedAddress: geo.matchedAddress,
    city,
    councilDistrict,
    localOfficials,
    state: geo.state,
    congress,
    congressionalDistrict: geo.congressionalDistrict,
    stateUpper: normalizeDistrict(geo.stateUpper),
    stateLower: normalizeDistrict(geo.stateLower),
    federal,
    stateLegislators,
    stateSource,
  };
}
