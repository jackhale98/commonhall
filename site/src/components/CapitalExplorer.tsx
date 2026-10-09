import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatMoney } from '../lib/finance';
import type { CapitalRow } from '../lib/local';
import { capitalProjectHref, href } from '../lib/paths';

const PAGE = 10;
const pageSize = () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? 5 : PAGE);

interface Props {
  /** Prerendered rows: the largest projects. */
  initial: CapitalRow[];
  departments: string[];
  neighborhoods: string[];
  statuses: string[];
  /** e.g. FY27, the plan's first year. */
  yearLabel: string;
}

/**
 * Capital Plan projects: search (name, scope, department), filters (department,
 * neighbourhood, status), sorted by budget. Loads the full list (capital.json,
 * built with the site) when it comes into view.
 */
export default function CapitalExplorer({ initial, departments, neighborhoods, statuses, yearLabel }: Props) {
  const [rows, setRows] = useState<CapitalRow[] | null>(null);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [hood, setHood] = useState('');
  const [status, setStatus] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setShown(pageSize());
    setMounted(true);
    fetch(href('boston/capital.json'))
      .then((r) => (r.ok ? (r.json() as Promise<CapitalRow[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setRows)
      .catch(() => undefined);
  }, []);

  const all = rows ?? initial;
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((p) => {
      if (dept && p.d !== dept) return false;
      if (hood && p.h !== hood) return false;
      if (status && p.s !== status) return false;
      const text = `${p.n} ${p.w ?? ''} ${p.d ?? ''} ${p.h ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [all, q, dept, hood, status]);
  const total = hits.reduce((n, p) => n + p.t, 0);
  const set =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setShown(pageSize());
    };
  const active = q || dept || hood || status;
  const reset = () => {
    setQ('');
    setDept('');
    setHood('');
    setStatus('');
    setShown(pageSize());
  };
  const select = (id: string, label: string, value: string, options: string[], onChange: (v: string) => void) => (
    <>
      <label for={id} class="visually-hidden">
        {label}
      </label>
      <select id={id} value={value} class={value ? 'is-set' : ''} onChange={(e) => onChange(e.currentTarget.value)}>
        <option value="">{label}</option>
        {options.map((o) => (
          <option value={o}>{o}</option>
        ))}
      </select>
    </>
  );

  return (
    <div>
      <form class="explorer-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <div class="explorer-query">
          <label for="cap-q" class="visually-hidden">
            Search projects
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="cap-q"
            type="search"
            value={q}
            placeholder="Project or place"
            onInput={(e) => set(setQ)(e.currentTarget.value)}
          />
        </div>
        <div class="explorer-filters matter-filters" role="group" aria-label="Filters">
          {select('cap-dept', 'Any department', dept, departments, set(setDept))}
          {select('cap-hood', 'Any neighborhood', hood, neighborhoods, set(setHood))}
          {select('cap-status', 'Any status', status, statuses, set(setStatus))}
          {active && (
            <button type="button" class="link-button clear-filters" onClick={reset}>
              Clear
            </button>
          )}
        </div>
      </form>
      <p class="small muted" aria-live="polite">
        {hits.length.toLocaleString()} {hits.length === 1 ? 'project' : 'projects'} · {formatMoney(total)} in total
      </p>
      {hits.length > 0 && (
        <div class="panel">
          <ul class={`list capital-list trimmable${mounted ? ' is-live' : ''}`}>
            {hits.slice(0, shown).map((p) => (
              <li key={p.i}>
                <p class="meta">{[p.d, p.h, p.s].filter(Boolean).join(' · ')}</p>
                <p class="capital-name">
                  <a href={capitalProjectHref(p.i)}>
                    <strong>{p.n}</strong>
                  </a>
                </p>
                {p.w && <p class="small capital-scope">{p.w}</p>}
                <p class="small muted">
                  Total budget <strong>{formatMoney(p.t)}</strong>
                  {p.y > 0 && (
                    <>
                      {' '}
                      · {formatMoney(p.y)} planned in {yearLabel}
                    </>
                  )}
                </p>
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
