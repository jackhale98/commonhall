/**
 * Load Middletown, Connecticut's Common Council: its members, meetings and agenda
 * items (packages/sync/src/loaders/middletown-agendas.ts). The "Load Middletown
 * agendas" workflow runs this daily and on demand. Needs `pdftotext` (poppler-utils).
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-middletown-agendas.ts [--since 2025-01-01] [--force] [--minutes 18]
 */
import { parseArgs } from 'node:util';
import { BROWSER_USER_AGENT, HttpClient } from '@civic/congress-client';
import { loadMiddletownAgendas, pdfText } from '@civic/sync/loaders';
import { connectDb } from './lib/db.ts';
import { recordRun } from './lib/record-run.ts';

async function main() {
  const { values } = parseArgs({
    options: {
      since: { type: 'string' },
      force: { type: 'boolean', default: false },
      minutes: { type: 'string', default: '18' },
    },
  });
  const runMinutes = Number(values.minutes);
  const sql = connectDb();
  // The city's firewall turns some scripted user agents away.
  const http = new HttpClient({ userAgent: BROWSER_USER_AGENT, maxAttempts: 3, baseDelayMs: 2000 });
  try {
    await recordRun(sql, 'load-middletown-agendas', runMinutes + 10, () =>
      loadMiddletownAgendas(sql, {
        http,
        pdfText,
        since: values.since,
        force: values.force,
        timeLimitMs: runMinutes * 60_000,
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
