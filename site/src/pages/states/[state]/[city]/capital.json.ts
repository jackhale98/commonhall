import { loadCityCapital } from '../../../../lib/build-data';
import type { City } from '../../../../lib/cities';
import { inCurrentBudget, projectRow } from '../../../../lib/city';
import { cityPaths } from '../../../../lib/city-pages';

export const getStaticPaths = () => cityPaths('budget');

/** Every project in the city's current capital plan or budget, compact, for the Budget tab's search and filters. */
export async function GET({ props }: { props: { city: City } }) {
  const view = await loadCityCapital(props.city.key);
  const rows = view ? view.projects.filter((p) => inCurrentBudget(p, view)).map(projectRow) : [];
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}
