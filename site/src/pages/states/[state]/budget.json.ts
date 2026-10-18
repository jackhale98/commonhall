import { loadStateBudgetLines, loadStateBudgets } from '../../../lib/build-data';
import { budgetLineRow } from '../../../lib/state-budget';

/** Only states with a budget on file. */
export async function getStaticPaths() {
  return [...(await loadStateBudgets()).keys()].map((code) => ({
    params: { state: code.toLowerCase() },
    props: { code },
  }));
}

/** Every line item of the state's newest budget, compact, for the Budget tab's search. */
export async function GET({ props }: { props: { code: string } }) {
  const rows = (await loadStateBudgetLines(props.code)).map(budgetLineRow);
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}
