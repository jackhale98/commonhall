import postgres from 'postgres';

/** Local Supabase database (`supabase start`). Override with TEST_DATABASE_URL. */
export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export function connect() {
  return postgres(DATABASE_URL, { max: 4, onnotice: () => undefined });
}
