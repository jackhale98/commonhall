import {
  loadDiscussions,
  loadPrerenderedBillIds,
  loadPrerenderLocalMatters,
  loadPrerenderStateBills,
} from '../lib/build-data';
import { stateBillHref } from '../lib/paths';
import type { PrerenderedIndex } from '../lib/prerendered';

/** Which items have a prerendered page; fallback routes use it to redirect to clean URLs. */
export async function GET() {
  const [bills, stateBills, matters, discussions] = await Promise.all([
    loadPrerenderedBillIds(),
    loadPrerenderStateBills(),
    loadPrerenderLocalMatters(),
    loadDiscussions(),
  ]);
  const index: PrerenderedIndex = {
    bills: [...bills].sort(),
    stateBills: Object.fromEntries(stateBills.map((b) => [b.id, stateBillHref(b.state, b.session, b.identifier)])),
    localMatters: matters.map((m) => m.matter.id).sort(),
    discussions: discussions.map((d) => d.id).sort(),
  };
  return new Response(JSON.stringify(index), { headers: { 'content-type': 'application/json' } });
}
