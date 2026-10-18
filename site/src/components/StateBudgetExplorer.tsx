import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatMoney } from '../lib/finance';
import type { BudgetLineRow } from '../lib/state-budget';

const PAGE = 10;
const pageSize = () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? 5 : PAGE);

interface Props {
  /** Prerendered rows: the largest line items. */
  initial: BudgetLineRow[];
  /** The state's budget.json, with every line item of the year. */
  jsonUrl: string;
  cabinets: string[];
  categories: string[];
  /** "FY27". */
  yearLabel: string;
}

/**
 * A state budget's line items (appropriation accounts): search by name, number or
 * department, filter by secretariat or category, largest first. Each shows what was
 * enacted and what has been spent so far. Loads every line (budget.json, built with
 * the site) once it comes into view.
 */
export default function StateBudgetExplorer({ initial, jsonUrl, cabinets, categories, yearLabel }: Props) {
  const [rows, setRows] = useState<BudgetLineRow[] | null>(null);
  const [q, setQ] = useState('');
  const [cabinet, setCabinet] = useState('');
  const [category, setCategory] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setShown(pageSize());
    setMounted(true);
    fetch(jsonUrl)
      .then((r) => (r.ok ? (r.json() as Promise<BudgetLineRow[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setRows)
      .catch(() => undefined);
  }, [jsonUrl]);

  const all = rows ?? initial;
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((l) => {
      if (cabinet && l.c !== cabinet) return false;
      if (category && l.k !== category) return false;
      // "7061-0008" and "70610008" both find the account.
      const text = `${l.n} ${l.d} ${l.a} ${l.a.slice(0, 4)}-${l.a.slice(4)}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [all, q, cabinet, category]);
  const enacted = hits.reduce((n, l) => n + l.e, 0);
  const spent = hits.reduce((n, l) => n + l.x, 0);
  const set =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setShown(pageSize());
    };
  const active = q || cabinet || category;
  const reset = () => {
    setQ('');
    setCabinet('');
    setCategory('');
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
          <label for="budget-q" class="visually-hidden">
            Search line items
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="budget-q"
            type="search"
            value={q}
            placeholder="Program, agency or account number"
            onInput={(e) => set(setQ)(e.currentTarget.value)}
          />
        </div>
        <div class="explorer-filters matter-filters" role="group" aria-label="Filters">
          {select('budget-cabinet', 'Any secretariat', cabinet, cabinets, set(setCabinet))}
          {select('budget-category', 'Any category', category, categories, set(setCategory))}
          {active && (
            <button type="button" class="link-button clear-filters" onClick={reset}>
              Clear
            </button>
          )}
        </div>
      </form>
      <p class="small muted" aria-live="polite">
        {hits.length.toLocaleString()} {hits.length === 1 ? 'line item' : 'line items'} · {formatMoney(enacted)}{' '}
        enacted, {formatMoney(spent)} spent so far
      </p>
      {hits.length > 0 && (
        <div class="panel">
          <ul class={`list capital-list trimmable${mounted ? ' is-live' : ''}`}>
            {hits.slice(0, shown).map((l) => {
              const scale = Math.max(l.e, l.v, l.x, 1);
              return (
                <li key={l.a}>
                  <p class="meta">
                    {l.a.slice(0, 4)}-{l.a.slice(4)} · {l.d}
                  </p>
                  <p class="capital-name">
                    <strong>{l.n}</strong>
                  </p>
                  <div class="funding-bar compact" aria-hidden="true">
                    {l.x > 0 && <span class="fund-1" style={{ flex: `${l.x / scale} 1 0` }} />}
                    <span class="fund-rest" style={{ flex: `${Math.max(0, 1 - l.x / scale)} 1 0` }} />
                  </div>
                  <p class="small muted">
                    <strong>{formatMoney(l.x)}</strong> spent of {formatMoney(l.e)} enacted for {yearLabel}
                    {l.s > 0 && <> (with {formatMoney(l.s)} in supplemental budgets)</>}
                    {Math.abs(l.v - l.e) >= 1 && <> · {formatMoney(l.v)} available</>}
                  </p>
                </li>
              );
            })}
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
