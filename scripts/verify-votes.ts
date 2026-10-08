/**
 * Phase 4 acceptance check: compare stored roll-call totals with the official
 * sources.
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/verify-votes.ts [--sample 10] [--id house-119-1-17 …]
 *
 * House: the Clerk's roll-call XML (votes.source_url), `<totals-by-vote>`.
 * Senate: senate.gov's roll-call XML `<count>` block, cross-checked against the
 * yea/nay tally printed in that session's vote menu.
 * Exits 1 if any sampled vote differs.
 */
import { parseArgs } from 'node:util';
import { XMLParser } from 'fast-xml-parser';
import postgres from 'postgres';
import { HttpClient, SenateClient, parseVoteId } from '@civic/congress-client';

interface Totals {
  yea: number;
  nay: number;
  present: number;
  notVoting: number;
}

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
const http = new HttpClient({ maxAttempts: 3 });
const senate = new SenateClient();

const num = (v: unknown) => Number.parseInt(String(v ?? '0'), 10) || 0;

export function parseClerkTotals(xml: string): Totals {
  const root = parser.parse(xml)['rollcall-vote'];
  const t = root?.['vote-metadata']?.['vote-totals']?.['totals-by-vote'];
  if (!t) throw new Error('No totals-by-vote in Clerk XML');
  return {
    yea: num(t['yea-total']),
    nay: num(t['nay-total']),
    present: num(t['present-total']),
    notVoting: num(t['not-voting-total']),
  };
}

async function main() {
  const { values } = parseArgs({
    options: { sample: { type: 'string', default: '10' }, id: { type: 'string', multiple: true } },
  });
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Set SUPABASE_DB_URL');
  const sql = postgres(url, { max: 2, prepare: false, onnotice: () => undefined });
  const n = Number(values.sample);
  const rows = values.id?.length
    ? await sql`select * from public.votes where id = any(${values.id}::text[])`
    : await sql`
        (select * from public.votes where chamber = 'house' order by random() limit ${Math.ceil(n / 2)})
        union all
        (select * from public.votes where chamber = 'senate' order by random() limit ${Math.floor(n / 2)})`;

  const menus = new Map<string, Awaited<ReturnType<SenateClient['getMenu']>>>();
  let failures = 0;
  for (const row of rows) {
    const stored: Totals = {
      yea: row.yea_total,
      nay: row.nay_total,
      present: row.present_total,
      notVoting: row.not_voting_total,
    };
    let official: Totals;
    let note = '';
    if (row.chamber === 'house') {
      if (!row.source_url?.endsWith('.xml')) {
        console.log(`${row.id}: no Clerk XML URL stored; skipped`);
        continue;
      }
      official = parseClerkTotals(await http.getText(row.source_url, 'application/xml'));
    } else {
      const ref = parseVoteId(row.id)!;
      const v = await senate.getVote(ref.congress, ref.session, ref.rollNumber);
      official = v.stated;
      const key = `${ref.congress}-${ref.session}`;
      if (!menus.has(key)) menus.set(key, await senate.getMenu(ref.congress, ref.session));
      const menu = menus.get(key)!.votes.find((m) => m.rollNumber === ref.rollNumber);
      if (menu && (menu.yeas !== official.yea || menu.nays !== official.nay))
        note = ` (menu says ${menu.yeas}-${menu.nays})`;
    }
    const ok =
      stored.yea === official.yea &&
      stored.nay === official.nay &&
      stored.present === official.present &&
      stored.notVoting === official.notVoting &&
      note === '';
    if (!ok) failures += 1;
    const fmt = (t: Totals) => `${t.yea}-${t.nay}-${t.present}-${t.notVoting}`;
    console.log(
      `${ok ? 'OK  ' : 'DIFF'} ${row.id.padEnd(18)} stored ${fmt(stored).padEnd(14)} official ${fmt(official)}${note}`,
    );
  }
  await sql.end();
  console.log(`${rows.length - failures}/${rows.length} match (yea-nay-present-not voting).`);
  if (failures > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
