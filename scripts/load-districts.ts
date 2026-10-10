/**
 * Load a city's council district boundaries into `council_districts`, from the
 * GeoJSON source listed for it in DISTRICT_SOURCES. Run once per city and after each
 * redistricting ("Load council districts" workflow, choosing the city):
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-districts.ts [--city ma-boston] [--url <GeoJSON URL>]
 *
 * District 0 is a city's whole boundary: for cities that elect everyone at-large (or
 * whose district map isn't published), so an address in the city finds its council.
 * Check that a source matches the current map before loading. A source drawn by
 * precinct (several features per district) is dissolved into one shape per district.
 */
import { parseArgs } from 'node:util';
import postgres from 'postgres';

export const DEFAULT_URL =
  'https://data.boston.gov/dataset/3e632d04-d7fe-4acd-bab7-75be4bdcfa96/resource/2d9092dd-5175-49ab-9b18-0c0efcef4153/download/city_council_districts___2023_2032.geojson';

interface Feature {
  properties: Record<string, unknown> & { EditDate?: number };
  geometry: { type: string; coordinates: unknown };
}

export interface DistrictSource {
  url: string;
  /** The feature property holding the district number; omit for a whole-city boundary (district 0). */
  districtProp?: string;
  nameProp?: string;
  /** How many districts the source should have (after dissolving precincts). */
  expect: number;
}

/** Somerville's wards: MassGIS Wards and Precincts (2022), the city's 28 precincts, dissolved by ward. */
export const SOMERVILLE_WARDS_URL =
  'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/WardsPrecincts2022/FeatureServer/0/query?where=TOWN%3D%27SOMERVILLE%27&outFields=TOWN,WARD,PRECINCT&outSR=4326&f=geojson';
/** A city's boundary from TIGERweb's current Incorporated Places layer, as GeoJSON in WGS 84. */
export function tigerPlace(geoid: string): string {
  return (
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query' +
    `?where=GEOID%3D%27${geoid}%27&outFields=GEOID,NAME&outSR=4326&f=geojson`
  );
}

/** Where each city's map comes from. */
export const DISTRICT_SOURCES: Record<string, DistrictSource> = {
  'ma-boston': { url: DEFAULT_URL, districtProp: 'DISTRICT', nameProp: 'LONGNAME', expect: 9 },
  'ma-somerville': { url: SOMERVILLE_WARDS_URL, districtProp: 'WARD', expect: 7 },
  // Whole-city boundaries (district 0) from the Census Bureau's TIGERweb (Incorporated Places, by GEOID).
  'ct-bristol': { url: tigerPlace('0908420'), nameProp: 'NAME', expect: 1 },
  'ct-middletown': { url: tigerPlace('0947290'), nameProp: 'NAME', expect: 1 },
  // Cambridge elects its council citywide: the city's boundary (Census TIGERweb, incorporated places, GEOID 2511000).
  'ma-cambridge': {
    url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query?where=GEOID%3D%272511000%27&outFields=NAME,GEOID&f=geojson',
    nameProp: 'NAME',
    expect: 1,
  },
};

export async function loadDistricts(
  sql: postgres.Sql,
  geojson: { features: Feature[] },
  source: string,
  city = 'ma-boston',
  props: { districtProp?: string; nameProp?: string } = { districtProp: 'DISTRICT', nameProp: 'LONGNAME' },
) {
  const rows = geojson.features
    .map((f) => ({
      district: props.districtProp ? Number(String(f.properties[props.districtProp] ?? '').replace(/\D/g, '')) : 0,
      name: props.nameProp ? String(f.properties[props.nameProp] ?? '') || null : null,
      f,
    }))
    .filter((r) => Number.isInteger(r.district) && r.district >= (props.districtProp ? 1 : 0));
  if (rows.length === 0) throw new Error(`No districts with a ${props.districtProp ?? 'boundary'} in that file`);
  const byDistrict = new Map<number, typeof rows>();
  for (const r of rows) byDistrict.set(r.district, [...(byDistrict.get(r.district) ?? []), r]);
  await sql.begin(async (tx) => {
    await tx`delete from public.council_districts where city = ${city}`;
    for (const [district, parts] of byDistrict) {
      const r = parts[0]!;
      const updated = r.f.properties.EditDate ? new Date(r.f.properties.EditDate).toISOString().slice(0, 10) : null;
      if (parts.length === 1) {
        await tx`
          insert into public.council_districts (city, district, name, geometry, source, source_updated)
          values (${city}, ${district}, ${r.name},
                  extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(${JSON.stringify(r.f.geometry)}), 4326)),
                  ${source}, ${updated})`;
      } else {
        // Precincts: one shape per district.
        await tx`
          insert into public.council_districts (city, district, name, geometry, source, source_updated)
          select ${city}, ${district}, ${r.name},
                 extensions.st_multi(extensions.st_union(extensions.st_setsrid(extensions.st_geomfromgeojson(g), 4326))),
                 ${source}, ${updated}
            from jsonb_array_elements_text(${JSON.stringify(parts.map((p) => p.f.geometry))}::text::jsonb) as g`;
      }
    }
  });
  return byDistrict.size;
}

async function main() {
  const { values } = parseArgs({
    options: { city: { type: 'string', default: 'ma-boston' }, url: { type: 'string' } },
  });
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('Set SUPABASE_DB_URL');
  // "all" loads every city with a source; stray spaces from a typed input are ignored.
  const wanted = values.city!.trim().toLowerCase();
  const cities = wanted === 'all' ? Object.keys(DISTRICT_SOURCES) : [wanted];
  for (const city of cities)
    if (!DISTRICT_SOURCES[city])
      throw new Error(`No district source for "${city}". Known: ${Object.keys(DISTRICT_SOURCES).join(', ')}, or all`);
  if (values.url && cities.length > 1) throw new Error('--url needs a single --city');
  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
  const failed: string[] = [];
  try {
    for (const city of cities) {
      const known = DISTRICT_SOURCES[city]!;
      const url = values.url ?? known.url;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
        const geojson = (await response.json()) as { features: Feature[] };
        const n = await loadDistricts(sql, geojson, url, city, known);
        if (n !== known.expect) throw new Error(`expected ${known.expect}, got ${n}; check the source`);
        console.log(`${city}: loaded ${n} district${n === 1 ? '' : 's'}.`);
      } catch (error) {
        failed.push(city);
        console.error(`${city}: ${error instanceof Error ? error.message : error}`);
      }
    }
  } finally {
    await sql.end();
  }
  if (failed.length) throw new Error(`Failed: ${failed.join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
