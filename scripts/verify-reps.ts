/**
 * Phase 5 acceptance check: run Find my reps for public addresses in several
 * states and compare the House member with the expected one for the sitting
 * Congress. Also prints senators and state legislators for review.
 *
 *   SUPABASE_DB_URL=… [OPENSTATES_API_KEY=…] npx tsx scripts/verify-reps.ts
 *
 * Without OPENSTATES_API_KEY, state legislators come from the database.
 */
import postgres from 'postgres';
import { CensusGeocoder, OpenStatesClient, congressForDate } from '@civic/congress-client';
import { findReps, type Sql } from '@civic/sync';

/** Public buildings, with the House member who represents them in the 119th Congress. */
export const ADDRESSES: { address: string; house: string }[] = [
  { address: '1100 Congress Ave, Austin, TX 78701', house: 'Doggett' },
  { address: '1600 Pennsylvania Ave NW, Washington, DC 20500', house: 'Norton' },
  { address: '1315 10th St, Sacramento, CA 95814', house: 'Matsui' },
  { address: '260 Broadway, New York, NY 10007', house: 'Goldman' },
  { address: '121 N LaSalle St, Chicago, IL 60602', house: 'Davis' },
  { address: '600 4th Ave, Seattle, WA 98104', house: 'Jayapal' },
  { address: '200 E Colfax Ave, Denver, CO 80203', house: 'DeGette' },
  { address: '24 Beacon St, Boston, MA 02133', house: 'Pressley' },
  { address: '200 W 24th St, Cheyenne, WY 82002', house: 'Hageman' },
  { address: '206 Washington St SW, Atlanta, GA 30334', house: 'Williams' },
  { address: '400 S Monroe St, Tallahassee, FL 32399', house: 'Dunn' },
];

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Set SUPABASE_DB_URL');
  const sql = postgres(url, { max: 2, prepare: false, onnotice: () => undefined }) as unknown as Sql;
  const key = process.env.OPENSTATES_API_KEY;
  const congress = congressForDate(new Date());
  let failures = 0;
  const states = new Set<string>();
  for (const { address, house } of ADDRESSES) {
    const result = await findReps(
      sql,
      {
        census: new CensusGeocoder(),
        openstates: key ? (budget) => new OpenStatesClient({ apiKey: key, budget, minIntervalMs: 1100 }) : undefined,
      },
      address,
      congress,
    );
    if (!result) {
      failures += 1;
      console.log(`FAIL ${address}: no match`);
      continue;
    }
    if (result.state) states.add(result.state);
    const rep = result.federal.find((m) => m.chamber === 'house');
    const senators = result.federal.filter((m) => m.chamber === 'senate').map((m) => m.name);
    const ok = Boolean(rep?.name.includes(house)) && (result.state === 'DC' || senators.length === 2);
    if (!ok) failures += 1;
    const district = result.congressionalDistrict === 0 ? 'AL' : result.congressionalDistrict;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${result.state}-${district} ${rep?.name ?? '(no House member)'} | senators: ${senators.join(', ') || '—'}` +
        ` | state upper ${result.stateUpper ?? '—'}, lower ${result.stateLower ?? '—'}: ` +
        (result.stateLegislators.map((l) => l.name).join(', ') || `(none; source ${result.stateSource})`),
    );
  }
  await sql.end();
  console.log(`${ADDRESSES.length - failures}/${ADDRESSES.length} addresses correct across ${states.size} states/DC.`);
  if (failures > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
