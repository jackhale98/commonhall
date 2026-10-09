import { loadDiscussionsByTarget, loadScotusCases } from '../../lib/build-data';
import { caseRows } from '../../lib/court';

/** Every loaded Supreme Court decision in compact form, for the court page's search and filters. */
export async function GET() {
  const [cases, discussions] = await Promise.all([loadScotusCases(), loadDiscussionsByTarget()]);
  const rows = caseRows(cases, (id) => discussions.has(`scotus_case:${id}`));
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}
