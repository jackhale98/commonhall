/**
 * Load Boston City Council district boundaries into `council_districts`.
 * Run after each redistricting (and once on a new project):
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-districts.ts [--url <GeoJSON URL>]
 *
 * Default source: Analyze Boston, "City Council Districts - 2023-2032" (GeoJSON,
 * WGS84). Check that the dataset matches the current district map before loading.
 */
import { parseArgs } from 'node:util';
import postgres from 'postgres';

export const DEFAULT_URL =
  'https://data.boston.gov/dataset/3e632d04-d7fe-4acd-bab7-75be4bdcfa96/resource/2d9092dd-5175-49ab-9b18-0c0efcef4153/download/city_council_districts___2023_2032.geojson';

interface Feature {
  properties: { DISTRICT?: number | string; LONGNAME?: string; EditDate?: number };
  geometry: { type: string; coordinates: unknown };
}

export async function loadDistricts(
  sql: postgres.Sql,
  geojson: { features: Feature[] },
  source: string,
  city = 'ma-boston',
) {
  const rows = geojson.features
    .map((f) => ({ district: Number(f.properties.DISTRICT), name: f.properties.LONGNAME ?? null, f }))
    .filter((r) => Number.isInteger(r.district) && r.district > 0);
  if (rows.length === 0) throw new Error('No districts with a DISTRICT property in that file');
  await sql.begin(async (tx) => {
    await tx`delete from public.council_districts where city = ${city}`;
    for (const r of rows) {
      const updated = r.f.properties.EditDate ? new Date(r.f.properties.EditDate).toISOString().slice(0, 10) : null;
      await tx`
        insert into public.council_districts (city, district, name, geometry, source, source_updated)
        values (${city}, ${r.district}, ${r.name},
                extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(${JSON.stringify(r.f.geometry)}), 4326)),
                ${source}, ${updated})`;
    }
  });
  return rows.length;
}

async function main() {
  const { values } = parseArgs({ options: { url: { type: 'string', default: DEFAULT_URL } } });
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('Set SUPABASE_DB_URL');
  const response = await fetch(values.url!);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const geojson = (await response.json()) as { features: Feature[] };
  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const n = await loadDistricts(sql, geojson, values.url!);
    console.log(`Loaded ${n} Boston council districts.`);
    if (n !== 9) console.warn(`Expected 9 districts, got ${n}. Check the dataset.`);
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
