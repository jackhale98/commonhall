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

/** Where each city's map comes from. */
export const DISTRICT_SOURCES: Record<string, DistrictSource> = {
  'ma-boston': { url: DEFAULT_URL, districtProp: 'DISTRICT', nameProp: 'LONGNAME', expect: 9 },
  'ma-somerville': { url: SOMERVILLE_WARDS_URL, districtProp: 'WARD', expect: 7 },
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
  const city = values.city!;
  const known = DISTRICT_SOURCES[city];
  if (!known) throw new Error(`No district source for ${city}; add one to DISTRICT_SOURCES`);
  const url = values.url ?? known.url;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const geojson = (await response.json()) as { features: Feature[] };
  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const n = await loadDistricts(sql, geojson, url, city, known);
    console.log(`Loaded ${n} ${city} district${n === 1 ? '' : 's'}.`);
    if (n !== known.expect) throw new Error(`Expected ${known.expect}, got ${n}. Check the source.`);
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
