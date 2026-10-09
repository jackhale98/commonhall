import { loadCapitalProjects } from '../../lib/build-data';
import { capitalRow } from '../../lib/local';

/** Every Capital Plan project in compact form, for the Budget tab's search and filters. */
export async function GET() {
  const rows = (await loadCapitalProjects()).map(capitalRow);
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}
