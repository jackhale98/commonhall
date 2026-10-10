import { loadStateLegislators } from '../../../lib/build-data';
import { LEGISLATURE_STATES } from '../../../lib/format';
import { chamberLabel } from '../../../lib/state-people';
import { legislatorRows } from '../../../lib/state-tabs';

export function getStaticPaths() {
  return LEGISLATURE_STATES.map((code) => ({ params: { state: code.toLowerCase() }, props: { code } }));
}

/** A state's legislators, by chamber and district, for its Legislature tab (loaded by the browser). */
export async function GET({ props }: { props: { code: string } }) {
  const { code } = props;
  const legislators = (await loadStateLegislators()).get(code) ?? [];
  const rows = legislatorRows(code, legislators, (c) => chamberLabel(code, c));
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}
