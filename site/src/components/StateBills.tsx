import { useEffect, useRef, useState } from 'preact/hooks';
import { STATE_BILL_COLUMNS, type StateBill } from '../lib/types';
import { stateBillHref } from '../lib/paths';
import { formatDate } from '../lib/format';
import { selectWithCount } from '../lib/rest';

const PAGE = 10;
/** Phones get half a page, so the sections below stay close. */
const pageSize = () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? 5 : PAGE);

/** Recent state bills (prerendered), with live search and paging. Following is on each bill's page. */
export default function StateBills({
  state,
  initial,
  total: initialTotal,
}: {
  state: string;
  initial: StateBill[];
  /** How many bills the state has (so the pager shows at once). */
  total?: number;
}) {
  const [bills, setBills] = useState(initial);
  const [size, setSize] = useState(PAGE);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(initialTotal ?? null);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    const s = pageSize();
    setSize(s);
    setBills((b) => b.slice(0, s));
  }, []);

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
      limit: size,
      offset: (page - 1) * size,
    })
      .then(({ rows, count }) => {
        setBills(rows);
        setTotal(count);
      })
      .catch(() => setTotal(0))
      .finally(() => setLoading(false));
  }, [q, page, state, size]);

  return (
    <div>
      <form
        class="explorer-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(String(new FormData(e.currentTarget as HTMLFormElement).get('q') ?? ''));
        }}
      >
        <div class="explorer-query">
          <label for={`sb-q-${state}`} class="visually-hidden">
            Search state bills
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input id={`sb-q-${state}`} name="q" type="search" placeholder="Title or bill #" />
          <button type="submit" class="primary">
            Search
          </button>
        </div>
      </form>
      {bills.length === 0 ? (
        <p class="muted">{loading ? 'Loading…' : 'No state bills loaded yet.'}</p>
      ) : (
        <div class="panel">
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
              </li>
            ))}
          </ul>
        </div>
      )}
      {total !== null && total > size && (
        <nav class="pager" aria-label="Pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {Math.ceil(total / size)}
          </span>
          <button type="button" disabled={page >= Math.ceil(total / size)} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
