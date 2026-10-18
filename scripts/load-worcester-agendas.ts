/**
 * Load the items on Worcester City Council agendas into the council matters
 * (packages/sync/src/loaders/worcester-agendas.ts). The "Load Worcester agendas"
 * workflow runs this daily; meetings already loaded are read again only while they
 * are recent (agendas get revised). Needs `pdftotext` (poppler-utils).
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-worcester-agendas.ts [--since 2025-01-01] [--force]
 */
import { parseArgs } from 'node:util';
import { PrimeGovClient } from '@civic/congress-client';
import { WORCESTER_AGENDAS_RUN_MINUTES, loadWorcesterAgendas, pdfText } from '@civic/sync/loaders';
import { connectDb } from './lib/db.ts';
import { recordRun } from './lib/record-run.ts';

async function main() {
  const { values } = parseArgs({ options: { since: { type: 'string' }, force: { type: 'boolean', default: false } } });
  const sql = connectDb();
  const primegov = new PrimeGovClient();
  try {
    await recordRun(sql, 'load-worcester-agendas', WORCESTER_AGENDAS_RUN_MINUTES + 10, () =>
      loadWorcesterAgendas(sql, {
        primegov,
        http: primegov.http,
        pdfText,
        since: values.since,
        force: values.force,
        log: console.log,
        warn: console.warn,
      }),
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
