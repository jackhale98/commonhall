import type { StateBill } from '../lib/types';
import { formatDate, stateName } from '../lib/format';
import { maLegislatureUrl, stateHref } from '../lib/paths';
import FollowButton from './FollowButton';

const CHAMBER: Record<string, string> = { upper: 'Senate', lower: 'House', legislature: 'Legislature' };

/** A state bill: title, sponsor, latest action and links to the official record. */
export default function StateBillView({ bill }: { bill: StateBill }) {
  const official = bill.state === 'MA' ? maLegislatureUrl(bill.session, bill.identifier) : null;
  return (
    <article>
      <p class="eyebrow">
        {bill.identifier} · {stateName(bill.state)}{' '}
        {bill.chamber ? (CHAMBER[bill.chamber] ?? bill.chamber) : 'Legislature'} · {bill.session} session
      </p>
      <h1 class="matter-title">{bill.title}</h1>
      {bill.primary_sponsor_name && <p class="meta">Sponsor: {bill.primary_sponsor_name}</p>}
      <div class="cluster" style={{ margin: '1rem 0' }}>
        <FollowButton targetType="state_bill" targetId={bill.id} label={bill.identifier} />
        {official && (
          <a class="button" href={official} rel="noopener">
            Full text on malegislature.gov
          </a>
        )}
        {bill.openstates_url && (
          <a class="button" href={bill.openstates_url} rel="noopener">
            History on Open States
          </a>
        )}
      </div>
      {bill.latest_action_text && (
        <div class="latest-action">
          <h2 class="h-small">Latest action</h2>
          <p>
            {formatDate(bill.latest_action_date)}: {bill.latest_action_text}
          </p>
        </div>
      )}
      <p class="small muted">
        More <a href={stateHref(bill.state)}>{stateName(bill.state)} bills and legislators</a>. State data from Open
        States, refreshed nightly.
      </p>
    </article>
  );
}
