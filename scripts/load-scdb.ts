/**
 * Load Supreme Court outcomes (who won, disposition, vote split) from the Supreme
 * Court Database into `scotus_outcomes`. The database publishes about once a year;
 * the "Load Supreme Court Database" workflow runs this monthly and on demand.
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-scdb.ts [--file <case-centered CSV or ZIP>]
 *
 * Without --file it finds the newest release on scdb.la.psu.edu and downloads the
 * case-centered file organised by citation. Needs `unzip` for the ZIP.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import {
  SCDB_BASE,
  caseCenteredCsvUrl,
  latestReleaseUrl,
  scdbOutcomeRows,
  writeScdbOutcomes,
  type Sql,
} from '@civic/sync';

const USER_AGENT = 'commonhall (+https://github.com/jackhale98/commonhall)';

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

/** The CSV text from a .csv or a .zip holding one. */
function csvText(bytes: Buffer, name: string): string {
  if (!/\.zip$/i.test(name) && bytes[0] !== 0x50) return bytes.toString('utf8');
  const dir = mkdtempSync(join(tmpdir(), 'scdb-'));
  try {
    const zip = join(dir, 'scdb.zip');
    writeFileSync(zip, bytes);
    return execFileSync('unzip', ['-p', zip, '*.csv'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function download(): Promise<{ csv: string; release: string }> {
  const latest = latestReleaseUrl(await (await get(`${SCDB_BASE}/data/`)).text());
  if (!latest) throw new Error('No release found on the SCDB data page; has the site changed?');
  const url = caseCenteredCsvUrl(await (await get(latest.url)).text());
  if (!url) throw new Error(`No case-centered citation CSV on ${latest.url}; has the page changed?`);
  const response = await get(url);
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? '';
  if (!/caseCentered_Citation/i.test(name)) throw new Error(`Unexpected SCDB file "${name}" from ${url}`);
  console.log(`Release ${latest.release}: ${name}`);
  return { csv: csvText(Buffer.from(await response.arrayBuffer()), name), release: latest.release };
}

async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('Set SUPABASE_DB_URL');
  const { csv, release } = values.file
    ? {
        csv: csvText(readFileSync(values.file), values.file),
        release: /SCDB_(\d{4}_\d{2})/.exec(values.file)?.[1] ?? 'local',
      }
    : await download();
  const rows = scdbOutcomeRows(csv, release);
  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const n = await writeScdbOutcomes(sql as unknown as Sql, rows);
    const terms = [...new Set(rows.map((r) => r.term))].sort();
    console.log(`Loaded ${n} cases, terms ${terms[0]}–${terms.at(-1)}, from SCDB release ${release}.`);
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
