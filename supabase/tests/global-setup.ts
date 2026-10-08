/**
 * The DB tests share the local Supabase database with development. Afterwards,
 * reload the seed files so `npm run test:db` leaves a usable dev database.
 */
import { connect, reloadSeed } from './db.ts';

export default function setup() {
  return async function teardown() {
    const sql = connect();
    try {
      await reloadSeed(sql);
    } finally {
      await sql.end();
    }
  };
}
