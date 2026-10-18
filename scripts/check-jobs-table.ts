/**
 * Fails when the README's scheduled-jobs table and the pg_cron jobs in the
 * migrations disagree: every `cron.schedule('name', …)` (less any later
 * `cron.unschedule('name')`) must appear in backticks in the table's first column,
 * and every backticked name there must be a scheduled job. Rows for GitHub Actions
 * have no backticked name and are not checked. CI runs this in the lint job.
 *
 *   npm run check:jobs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const migrations = join(root, 'supabase/migrations');

const scheduled = new Set<string>();
for (const file of readdirSync(migrations)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  const sql = readFileSync(join(migrations, file), 'utf8');
  for (const [, un, name] of sql.matchAll(/cron\.(un)?schedule\(\s*'([^']+)'/g)) {
    if (un) scheduled.delete(name!);
    else scheduled.add(name!);
  }
}

const readme = readFileSync(join(root, 'README.md'), 'utf8').split('\n');
const start = readme.findIndex((line) => line.startsWith('| Scheduled job |'));
if (start < 0) throw new Error('README.md has no "| Scheduled job |" table');
const listed = new Set<string>();
for (const line of readme.slice(start + 2)) {
  if (!line.startsWith('|')) break;
  const first = line.split('|')[1] ?? '';
  for (const [, name] of first.matchAll(/`([^`]+)`/g)) listed.add(name!);
}

const missing = [...scheduled].filter((name) => !listed.has(name)).sort();
const extra = [...listed].filter((name) => !scheduled.has(name)).sort();
for (const name of missing) console.error(`Scheduled in the migrations but not in the README jobs table: ${name}`);
for (const name of extra) console.error(`In the README jobs table but not scheduled in any migration: ${name}`);
if (missing.length || extra.length) process.exit(1);
console.log(`README jobs table matches the ${scheduled.size} pg_cron jobs.`);
