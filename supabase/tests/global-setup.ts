/**
 * The DB tests share the local Supabase database with development. Afterwards,
 * reload supabase/seed.sql so `npm run test:db` leaves a usable dev database.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect } from './db.ts';

const DATA_TABLES = [
  'public.bill_actions',
  'public.bill_cosponsors',
  'public.bill_subjects',
  'public.bills',
  'public.members',
  'public.archive_cache',
  'public.api_usage',
  'public.sync_state',
  'public.sync_lock',
];

export default function setup() {
  return async function teardown() {
    const sql = connect();
    try {
      const existing = await sql<{ name: string }[]>`
        select format('%I.%I', schemaname, tablename) as name from pg_tables
         where format('%I.%I', schemaname, tablename) = any(${DATA_TABLES}::text[])
            or schemaname = 'public' and tablename in ('votes', 'vote_positions', 'feed_events', 'follows',
              'state_bills', 'state_legislators', 'profiles', 'feed_reads')`;
      if (existing.length > 0) await sql.unsafe(`truncate ${existing.map((r) => r.name).join(', ')} cascade`);
      const seed = readFileSync(fileURLToPath(new URL('../seed.sql', import.meta.url)), 'utf8');
      await sql.unsafe(seed);
    } finally {
      await sql.end();
    }
  };
}
