import { useEffect, useRef, useState } from 'preact/hooks';
import { STATE_BILL_COLUMNS, type StateBill } from '../lib/types';
import { stateBillHref } from '../lib/paths';
import { formatDate } from '../lib/format';
import { selectWithCount } from '../lib/rest';
import FollowButton from './FollowButton';

const PAGE = 20;

/** Recent state bills (prerendered), with live search and paging. */
export default function StateBills({ state, initial }: { state: string; initial: StateBill[] }) {
  const [bills, setBills] = useState(initial);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setLoading(true);
    const term = q.trim().replace(/[*,()]/g, ' ');
    selectWithCount<StateBill>('state_bills', {
      select: STATE_BILL_COLUMNS,
      state: `eq.${state}`,
      ...(term ? { or: `(title.ilike.*${term}*,identifier.ilike.*${term}*)` } : {}),
      order: 'latest_action_date.desc.nullslast,id.asc',
      limit: PAGE,
      offset: (page - 1) * PAGE,
    })
      .then(({ rows, count }) => {
        setBills(rows);
        setTotal(count);
      })
      .catch(() => setTotal(0))
      .finally(() => setLoading(false));
  }, [q, page, state]);

  return (
    <div>
      <form
        class="toolbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(String(new FormData(e.currentTarget as HTMLFormElement).get('q') ?? ''));
        }}
      >
        <div class="field" style={{ flexBasis: '18rem' }}>
          <label for={`sb-q-${state}`}>Search state bills</label>
          <input id={`sb-q-${state}`} name="q" type="search" placeholder="Title or number, e.g. HB 12" />
        </div>
        <button type="submit">Search</button>
      </form>
      {bills.length === 0 ? (
        <p class="muted">{loading ? 'Loading…' : 'No state bills loaded yet.'}</p>
      ) : (
        <ul class="list" aria-busy={loading}>
          {bills.map((b) => (
            <li class="state-bill">
              <div>
                <p class="meta">
                  <strong>{b.identifier}</strong> · {b.session}
                  {b.primary_sponsor_name && <> · {b.primary_sponsor_name}</>}
                </p>
                <p class="bill-title-sm">
                  <a href={stateBillHref(b.state, b.session, b.identifier)}>{b.title}</a>
                </p>
                {b.latest_action_text && (
                  <p class="meta">
                    {formatDate(b.latest_action_date)}: {b.latest_action_text}
                  </p>
                )}
              </div>
              <FollowButton targetType="state_bill" targetId={b.id} label={`${b.state} ${b.identifier}`} />
            </li>
          ))}
        </ul>
      )}
      {total !== null && total > PAGE && (
        <nav class="pager" aria-label="Pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {Math.ceil(total / PAGE)}
          </span>
          <button type="button" disabled={page >= Math.ceil(total / PAGE)} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
