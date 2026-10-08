import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/** Local Supabase database (`supabase start`). Override with TEST_DATABASE_URL. */
export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export function connect() {
  return postgres(DATABASE_URL, { max: 4, onnotice: () => undefined });
}

/** Empty every data table in public and load supabase/seed.sql. */
export async function reloadSeed(sql: postgres.Sql) {
  const tables = await sql<{ name: string }[]>`
    select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public'`;
  if (tables.length > 0) await sql.unsafe(`truncate ${tables.map((t) => t.name).join(', ')} cascade`);
  await sql.unsafe(readFileSync(fileURLToPath(new URL('../seed.sql', import.meta.url)), 'utf8'));
}
