import { useEffect, useState } from 'preact/hooks';
import { STATE_BILL_COLUMNS, type StateBill } from '../lib/types';
import { slug, stateBillHref } from '../lib/paths';
import { redirectIfPrerendered } from '../lib/prerendered';
import { select } from '../lib/rest';
import DiscussionRequest from './DiscussionRequest';
import StateBillSponsors from './StateBillSponsors';
import StateBillView from './StateBillView';
import Loader from './Loader';

/**
 * Client-rendered page for state bills without a prerendered page. Accepts ?id=<Open
 * States id> or the parts of a clean URL (?state=ma&session=194th&bill=h-1234).
 */
export default function StateBillFallback() {
  const [bill, setBill] = useState<StateBill | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    (async () => {
      let row: StateBill | undefined;
      const id = q.get('id');
      if (id?.startsWith('ocd-bill/')) {
        [row] = await select<StateBill>('state_bills', { id: `eq.${id}`, select: STATE_BILL_COLUMNS });
      } else {
        const st = (q.get('state') ?? '').toUpperCase();
        const session = q.get('session') ?? '';
        const billSlug = q.get('bill') ?? '';
        if (!/^[A-Z]{2}$/.test(st) || !/^[a-z0-9-]+$/.test(billSlug)) return setState('missing');
        // "h-1234" → "H 1234" / "H1234"; compare slugs to tolerate either spelling.
        const parts = billSlug.toUpperCase().split('-');
        const candidates = await select<StateBill>('state_bills', {
          select: STATE_BILL_COLUMNS,
          state: `eq.${st}`,
          or: `(identifier.eq.${parts.join(' ')},identifier.eq.${parts.join('')})`,
          limit: 20,
        });
        row = candidates.find((b) => slug(b.identifier) === billSlug && (!session || slug(b.session) === session));
      }
      if (!row) return setState('missing');
      const clean = stateBillHref(row.state, row.session, row.identifier);
      if (await redirectIfPrerendered((i) => (i.stateBills[row!.id] ? clean : null))) return;
      setBill(row);
      setState('ready');
      document.title = `${row.identifier}: ${row.title.slice(0, 80)} · ${document.title.split(' · ').pop()}`;
    })().catch(() => setState('error'));
  }, []);

  if (state === 'loading') return <Loader label="Loading state bill" />;
  if (state === 'missing') return <p class="notice">We don’t have that state bill. It may not be synced yet.</p>;
  if (state === 'error' || !bill) return <p class="notice error">Couldn’t load this bill.</p>;
  return (
    <>
      <DiscussionRequest targetType="state_bill" targetId={bill.id} />
      <StateBillView bill={bill}>
        <StateBillSponsors billId={bill.id} />
      </StateBillView>
    </>
  );
}
