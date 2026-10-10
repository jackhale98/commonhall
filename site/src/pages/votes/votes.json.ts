import { loadVotesAbout } from '../../lib/build-data';
import { voteRow } from '../../lib/votes';

/** Every roll call this Congress in compact form, for the votes page's search and filters. */
export async function GET() {
  const rows = (await loadVotesAbout()).map(voteRow);
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}
