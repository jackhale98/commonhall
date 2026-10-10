/**
 * Load state legislators, statewide officials (governors and others) and state committees from Open States'
 * people repository (github.com/openstates/people, CC0). The "Load state people and
 * committees" workflow runs this weekly and on demand.
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-state-people.ts [--dir <checkout>] [--states ma,ny]
 *
 * Without --dir it downloads the repository archive from GitHub and unpacks only the
 * legislature and committee files (needs `tar`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { parse } from 'yaml';
import { lightenPhotos, writeStatePeople, type PeopleCommittee, type PeoplePerson, type Sql } from '@civic/sync';
import { recordRun } from './lib/record-run.ts';

const ARCHIVE = 'https://codeload.github.com/openstates/people/tar.gz/refs/heads/main';
const USER_AGENT = 'commonhall (+https://github.com/jackhale98/commonhall)';

/** Unpack the archive's legislature and committee files; returns the data directory. */
async function download(dir: string): Promise<string> {
  const response = await fetch(ARCHIVE, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${ARCHIVE}: HTTP ${response.status}`);
  const file = join(dir, 'people.tar.gz');
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  execFileSync('tar', [
    '-xzf',
    file,
    '-C',
    dir,
    '--wildcards',
    '*/data/*/legislature/*.yml',
    '*/data/*/committees/*.yml',
    '*/data/*/executive/*.yml',
  ]);
  const root = readdirSync(dir).find((d) => d.startsWith('people-') || d.startsWith('openstates-people'));
  if (!root) throw new Error('The archive had no people-* folder; has the repository changed?');
  return join(dir, root, 'data');
}

function readYaml<T>(folder: string): T[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => parse(readFileSync(join(folder, f), 'utf8')) as T);
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, states: { type: 'string' } } });
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('Set SUPABASE_DB_URL');
  const tmp = values.dir ? null : mkdtempSync(join(tmpdir(), 'people-'));
  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await recordRun(sql, 'load-state-people', 45, async () => {
      const data = values.dir
        ? existsSync(join(values.dir, 'data'))
          ? join(values.dir, 'data')
          : values.dir
        : await download(tmp!);
      const only = values.states?.toLowerCase().split(',').filter(Boolean);
      // Two-letter state folders; "us" is Congress, which has its own source.
      const states = readdirSync(data)
        .filter((s) => /^[a-z]{2}$/.test(s) && s !== 'us' && (!only || only.includes(s)))
        .sort();
      const totals = { states: 0, updated: 0, added: 0, retired: 0, committees: 0, members: 0 };
      for (const state of states) {
        const people = readYaml<PeoplePerson>(join(data, state, 'legislature'));
        const committees = readYaml<PeopleCommittee>(join(data, state, 'committees'));
        const executives = readYaml<PeoplePerson>(join(data, state, 'executive'));
        if (!people.length && !committees.length) continue;
        const r = await writeStatePeople(sql as unknown as Sql, state.toUpperCase(), people, committees, executives);
        totals.states++;
        totals.updated += r.legislatorsUpdated;
        totals.added += r.legislatorsAdded;
        totals.retired += r.legislatorsRetired;
        totals.committees += r.committees;
        totals.members += r.members;
        console.log(
          `${state.toUpperCase()}: ${r.legislatorsUpdated + r.legislatorsAdded} legislators (${r.legislatorsAdded} new, ${r.legislatorsRetired} left office), ${r.executives} statewide officials, ${r.committees} committees`,
        );
      }
      console.log(
        `Loaded ${totals.states} states: ${totals.updated + totals.added} legislators (${totals.added} new, ${totals.retired} left office), ${totals.committees} committees with ${totals.members} seats.`,
      );
      // Smaller copies of heavy photos (or initials), checked once per photo.
      const photos = await lightenPhotos(sql as unknown as Sql, { log: console.log });
      return totals.updated + totals.added + totals.retired + photos.replaced + photos.removed;
    });
  } finally {
    await sql.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
