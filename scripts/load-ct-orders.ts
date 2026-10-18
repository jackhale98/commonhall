/**
 * Load Connecticut governors' executive orders (packages/sync/src/loaders/ct-orders.ts).
 * The "Load CT governor orders" workflow runs this weekly and on demand. Needs
 * `pdftotext` (poppler-utils).
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-ct-orders.ts [--refresh]
 */
import { parseArgs } from 'node:util';
import { HttpClient } from '@civic/congress-client';
import { loadCtOrders, pdfText } from '@civic/sync/loaders';
import { connectDb } from './lib/db.ts';
import { recordRun } from './lib/record-run.ts';

async function main() {
  const { values } = parseArgs({ options: { refresh: { type: 'boolean', default: false } } });
  const sql = connectDb();
  const http = new HttpClient({ minIntervalMs: 500, maxAttempts: 3 });
  try {
    await recordRun(sql, 'load-ct-orders', 20, () =>
      loadCtOrders(sql, { http, pdfText, refresh: values.refresh, log: console.log }),
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
