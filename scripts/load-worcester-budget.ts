/**
 * Load Worcester's capital and operating budgets (packages/sync/src/loaders/worcester-budget.ts).
 * The "Load Worcester budget" workflow runs this monthly and on demand; it skips a
 * document it has already loaded. Needs `pdftotext` (poppler-utils).
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-worcester-budget.ts [--force] [--file budget.pdf --year 2027 --stage proposed]
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { HttpClient } from '@civic/congress-client';
import { loadWorcesterBudget, pdfText } from '@civic/sync/loaders';
import { connectDb } from './lib/db.ts';
import { recordRun } from './lib/record-run.ts';

async function main() {
  const { values } = parseArgs({
    options: {
      force: { type: 'boolean', default: false },
      file: { type: 'string' },
      year: { type: 'string' },
      stage: { type: 'string' },
    },
  });
  const sql = connectDb();
  const http = new HttpClient({ maxAttempts: 3 });
  const file = values.file
    ? {
        pdf: new Uint8Array(readFileSync(values.file)),
        fiscalYear: Number(values.year),
        stage: values.stage === 'proposed' ? ('proposed' as const) : ('adopted' as const),
        path: values.file,
      }
    : undefined;
  try {
    await recordRun(sql, 'load-worcester-budget', 30, () =>
      loadWorcesterBudget(sql, { http, pdfText, force: values.force, file, log: console.log }),
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
