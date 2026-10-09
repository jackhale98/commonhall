import { loadNominations, loadVotesByNomination } from '../../lib/build-data';
import { nominationRows } from '../../lib/executive';
import { voteHref } from '../../lib/paths';

/** Civilian nominations this Congress in compact form, for the executive page's search and filters. */
export async function GET() {
  const [nominations, votes] = await Promise.all([loadNominations(), loadVotesByNomination()]);
  const rows = nominationRows(nominations, (n) => {
    const v = votes.get(n.id)?.find((x) => /nomination/i.test(x.question ?? ''));
    return v ? { href: voteHref(v.id), yea: v.yea_total, nay: v.nay_total } : undefined;
  });
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
}
