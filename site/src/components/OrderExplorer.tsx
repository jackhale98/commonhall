import { useEffect, useMemo, useState } from 'preact/hooks';
import type { OrderRow, OrderTerm } from '../lib/executive';
import { formatDate } from '../lib/format';
import { executiveOrderHref, href } from '../lib/paths';

const PAGE = 30;
/** Phones start with fewer, so the page's other sections stay close. */
const PHONE_PAGE = 8;
const pageSize = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? PHONE_PAGE : PAGE;

type Status = '' | 'in-effect' | 'revoked' | 'revokes';

interface Props {
  /** Presidential terms, newest first. */
  terms: OrderTerm[];
  /** Prerendered rows: the current term's latest orders. */
  initial: OrderRow[];
}

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Executive orders with search and filters (term, year, revoked or not, has a
 * discussion). Starts from the prerendered latest orders and loads the full
 * list (orders.json, built with the site) when it comes into view.
 */
export default function OrderExplorer({ terms, initial }: Props) {
  const current = terms[0]?.key ?? '';
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState(current);
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<Status>('');
  const [discussed, setDiscussed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  // Prerendered with PAGE rows (CSS trims them on phones until hydration); then the device's size.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setShown(pageSize());
    setMounted(true);
  }, []);

  useEffect(() => {
    fetch(href('executive/orders.json'))
      .then((r) => (r.ok ? (r.json() as Promise<OrderRow[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setRows)
      .catch(() => setFailed(true));
  }, []);

  const all = rows ?? initial;
  const byNumber = useMemo(() => new Map(all.filter((r) => r.n).map((r) => [r.n!, r])), [all]);
  const termName = useMemo(() => new Map(terms.map((t) => [t.key, t.name])), [terms]);
  const years = useMemo(
    () => [...new Set(all.filter((r) => !term || r.g === term).map((r) => r.s.slice(0, 4)))].sort().reverse(),
    [all, term],
  );

  const hits = useMemo(() => {
    const terms = words(q);
    return all.filter((r) => {
      if (term && r.g !== term) return false;
      if (year && !r.s.startsWith(year)) return false;
      if (status === 'revoked' && !r.rb) return false;
      if (status === 'in-effect' && r.rb) return false;
      if (status === 'revokes' && !r.rv) return false;
      if (discussed && !r.x) return false;
      if (terms.length === 0) return true;
      const text = `${r.t} eo ${r.n ?? ''} ${r.n ?? ''} ${termName.get(r.g) ?? ''}`.toLowerCase();
      return terms.every((w) => text.includes(w));
    });
  }, [all, q, term, year, status, discussed, termName]);

  const active = q || term !== current || year || status || discussed;
  const reset = () => {
    setQ('');
    setTerm(current);
    setYear('');
    setStatus('');
    setDiscussed(false);
    setShown(pageSize());
  };
  const set =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setShown(pageSize());
    };
  const termLabel = terms.find((t) => t.key === term);
  const orderLink = (n: number) => {
    const r = byNumber.get(n);
    return r ? <a href={executiveOrderHref(r.d)}>EO {n}</a> : `EO ${n}`;
  };

  return (
    <div>
      <form class="explorer-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <div class="explorer-query">
          <label for="eo-q" class="visually-hidden">
            Search executive orders
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="eo-q"
            type="search"
            value={q}
            placeholder="Topic or EO #"
            onInput={(e) => set(setQ)(e.currentTarget.value)}
          />
        </div>
        <div class="explorer-filters" role="group" aria-label="Filters">
          <label for="eo-term" class="visually-hidden">
            President
          </label>
          <select
            id="eo-term"
            value={term}
            class={term !== current ? 'is-set' : ''}
            onChange={(e) => {
              set(setTerm)(e.currentTarget.value);
              setYear('');
            }}
          >
            {terms.map((t) => (
              <option value={t.key}>
                {t.name} ({t.from === t.to ? t.from : `${t.from}–${t.to}`})
              </option>
            ))}
            <option value="">All presidents since 2009</option>
          </select>
          <label for="eo-year" class="visually-hidden">
            Year
          </label>
          <select
            id="eo-year"
            value={year}
            class={year ? 'is-set' : ''}
            onChange={(e) => set(setYear)(e.currentTarget.value)}
          >
            <option value="">Any year</option>
            {years.map((y) => (
              <option value={y}>{y}</option>
            ))}
          </select>
          <label for="eo-status" class="visually-hidden">
            Status
          </label>
          <select
            id="eo-status"
            value={status}
            class={status ? 'is-set' : ''}
            onChange={(e) => set(setStatus)(e.currentTarget.value as Status)}
          >
            <option value="">Any status</option>
            <option value="in-effect">Not revoked</option>
            <option value="revoked">Revoked</option>
            <option value="revokes">Revokes earlier orders</option>
          </select>
          <button
            type="button"
            class="filter-toggle"
            aria-pressed={discussed}
            onClick={() => set(setDiscussed)(!discussed)}
          >
            Has a discussion
          </button>
          {active && (
            <button type="button" class="link-button clear-filters" onClick={reset}>
              Clear
            </button>
          )}
        </div>
      </form>

      <p class="small muted" aria-live="polite">
        {rows === null && !failed
          ? 'Loading every order…'
          : `${hits.length.toLocaleString()} order${hits.length === 1 ? '' : 's'}${
              termLabel ? ` by ${termLabel.name}` : ' since 2009'
            }${year ? ` in ${year}` : ''}`}
        {failed && ' Showing the latest orders only; the full list didn’t load.'}
      </p>

      {hits.length === 0 ? (
        <p class="muted">
          No orders match.{' '}
          <button type="button" class="link-button" onClick={reset}>
            Clear filters
          </button>
        </p>
      ) : (
        <div class="panel">
          <ul class={`list eo-list trimmable${mounted ? ' is-live' : ''}`}>
            {hits.slice(0, shown).map((r) => (
              <li key={r.d}>
                <p class="meta">
                  {r.n ? `EO ${r.n}` : 'Executive order'} · signed {formatDate(r.s)}
                  {!term && ` · ${termName.get(r.g) ?? ''}`}
                </p>
                <p class="eo-title">
                  <a href={executiveOrderHref(r.d)}>{r.t}</a>
                  {r.x && <span class="chip">Discussion</span>}
                </p>
                {(r.rv || r.rb) && (
                  <p class="small muted">
                    {r.rv && (
                      <>
                        Revokes{' '}
                        {r.rv.map((n, i) => (
                          <>
                            {i > 0 && ', '}
                            {orderLink(n)}
                          </>
                        ))}
                        {r.rb && ' · '}
                      </>
                    )}
                    {r.rb && (
                      <strong>
                        Revoked by{' '}
                        {r.rb.map((n, i) => (
                          <>
                            {i > 0 && ', '}
                            {orderLink(n)}
                          </>
                        ))}
                      </strong>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {hits.length > shown && (
            <button type="button" onClick={() => setShown(shown + pageSize())}>
              Show more ({(hits.length - shown).toLocaleString()} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
