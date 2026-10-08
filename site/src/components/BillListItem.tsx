import { billDisplayTitle, billNumberLabel, formatDate, statusLabel } from '../lib/format';
import { statusProgress } from '../lib/charts';
import { billHref } from '../lib/paths';
import type { BillListItem as Bill } from '../lib/types';

interface Props {
  bill: Bill;
  /** Link to the client-rendered fallback route (bill newer than the last build). */
  href?: string;
}

export default function BillListItem({ bill, href }: Props) {
  return (
    <li class="bill-item">
      <p class="meta">
        <strong>{billNumberLabel(bill)}</strong> · <span class="status-chip">{statusLabel(bill.status)}</span>
        {bill.policy_area && <> · {bill.policy_area}</>}
      </p>
      <h3 class="bill-title">
        <a href={href ?? billHref(bill.congress, bill.bill_type, bill.number)}>{billDisplayTitle(bill)}</a>
      </h3>
      <span class="progress" aria-hidden="true">
        <span style={{ width: `${Math.round(statusProgress(bill.status) * 100)}%` }} />
      </span>
      {bill.latest_action_text && (
        <p class="meta">
          {formatDate(bill.latest_action_date)}: {bill.latest_action_text}
        </p>
      )}
    </li>
  );
}
