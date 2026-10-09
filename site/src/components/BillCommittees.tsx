import type { BillCommittee } from '../lib/committees';
import { formatDate } from '../lib/format';
import { href } from '../lib/paths';

/** The committees a bill was sent to, with whether each has reported it. */
export default function BillCommittees({ rows, known }: { rows: BillCommittee[]; known?: Set<string> }) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (a.referred_date ?? '').localeCompare(b.referred_date ?? ''));
  return (
    <ul class="plain-list bill-committees">
      {sorted.map((c) => {
        const name = c.committee_name ?? c.committee_code;
        const linked = !known || known.has(c.committee_code);
        return (
          <li>
            {linked ? <a href={href(`committees/${c.committee_code}/`)}>{name}</a> : name}
            <span class="small muted">
              {' '}
              ·{' '}
              {c.reported_date
                ? `reported ${formatDate(c.reported_date)}`
                : c.referred_date
                  ? `since ${formatDate(c.referred_date)}`
                  : 'referred'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
