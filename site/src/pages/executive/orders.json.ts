import { loadDiscussionsByTarget, loadExecutiveOrders } from '../../lib/build-data';
import { orderRows } from '../../lib/executive';

/** Every executive order since 2009 in compact form, for the executive page's search and filters. */
export async function GET() {
  const [orders, discussions] = await Promise.all([loadExecutiveOrders(), loadDiscussionsByTarget()]);
  const rows = orderRows(orders, (doc) => discussions.has(`executive_order:${doc}`));
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}
