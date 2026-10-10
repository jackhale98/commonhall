import { loadZbaAppeals } from '../../../../lib/build-data';
import type { City } from '../../../../lib/cities';
import { cityPaths } from '../../../../lib/city-pages';
import { zbaRow } from '../../../../lib/local';

export const getStaticPaths = () => cityPaths('neighborhoods');

/** Zoning appeals in compact form, for the Neighborhoods tab's search and filters. */
export async function GET({ props }: { props: { city: City } }) {
  const rows = (await loadZbaAppeals(props.city.key)).map(zbaRow);
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}
