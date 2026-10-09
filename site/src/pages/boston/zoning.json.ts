import { loadZbaAppeals } from '../../lib/build-data';
import { zbaRow } from '../../lib/local';

/** Zoning Board of Appeal cases in compact form, for the Neighborhoods tab's search and filters. */
export async function GET() {
  const rows = (await loadZbaAppeals()).map(zbaRow);
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}
