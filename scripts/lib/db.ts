/** The database connection a loader script uses (SUPABASE_DB_URL: the session pooler URL in GitHub Actions). */
import postgres from 'postgres';
import type { Sql } from '@civic/sync';

export function connectDb(): Sql {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Set SUPABASE_DB_URL');
  return postgres(url, { max: 2, prepare: false, onnotice: () => undefined }) as unknown as Sql;
}
