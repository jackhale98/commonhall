import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatMoney } from '../lib/finance';
import { yearSpend, type CapitalItem } from '../lib/worcester';

const PAGE = 10;
const pageSize = () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? 5 : PAGE);

interface Budget {
  label: string;
  items: CapitalItem[];
}

/**
 * Worcester's capital projects for a fiscal year: search, department filter, and
 * a switch between budgets (this year's proposal and last year's adopted budget).
 */
export default function WorcesterCapital({ budgets }: { budgets: Budget[] }) {
  const [which, setWhich] = useState(0);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [shown, setShown] = useState(PAGE);
  // Phones get half a page, so the list stays short.
  useEffect(() => setShown(pageSize()), []);
  const items = budgets[which]?.items ?? [];
  const departments = useMemo(() => [...new Set(items.map((i) => i.department))].sort(), [items]);
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items
      .filter((i) => {
        if (dept && i.department !== dept) return false;
        const text = `${i.title} ${i.description ?? ''} ${i.department} ${i.category ?? ''}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .sort((a, b) => yearSpend(b) - yearSpend(a) || b.new_authorization - a.new_authorization);
  }, [items, q, dept]);
  const total = hits.reduce((n, i) => n + yearSpend(i), 0);
  const reset = (fn: () => void) => {
    fn();
    setShown(pageSize());
  };

  return (
    <div>
      {budgets.length > 1 && (
        <div class="type-chips budget-years" role="group" aria-label="Budget year">
          {budgets.map((b, i) => (
            <button
              type="button"
              class="chip-button"
              aria-pressed={i === which}
              onClick={() =>
                reset(() => {
                  setWhich(i);
                  setDept('');
                })
              }
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      <form class="explorer-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <div class="explorer-query">
          <label for="wc-q" class="visually-hidden">
            Search projects
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="wc-q"
            type="search"
            value={q}
            placeholder="Project, place or department"
            onInput={(e) => reset(() => setQ(e.currentTarget.value))}
          />
        </div>
        <div class="explorer-filters" role="group" aria-label="Filters">
          <label for="wc-dept" class="visually-hidden">
            Department
          </label>
          <select
            id="wc-dept"
            value={dept}
            class={dept ? 'is-set' : ''}
            onChange={(e) => reset(() => setDept(e.currentTarget.value))}
          >
            <option value="">Any department</option>
            {departments.map((d) => (
              <option value={d}>{d}</option>
            ))}
          </select>
        </div>
      </form>
      <p class="small muted" aria-live="polite">
        {hits.length} {hits.length === 1 ? 'project' : 'projects'} · {formatMoney(total)} in borrowing and cash this
        year
      </p>
      {hits.length > 0 && (
        <div class="panel">
          <ul class="list capital-list">
            {hits.slice(0, shown).map((i) => {
              const money = [
                i.borrowing > 0 && `${formatMoney(i.borrowing)} borrowed`,
                i.cash > 0 && `${formatMoney(i.cash)} cash`,
                i.grants > 0 && `${formatMoney(i.grants)} grants`,
                i.new_authorization > 0 && `${formatMoney(i.new_authorization)} new borrowing approved`,
              ].filter(Boolean);
              return (
                <li key={i.seq}>
                  <p class="meta">{[i.department, i.category].filter(Boolean).join(' · ')}</p>
                  <p class="capital-name">
                    <strong>{i.title}</strong>
                  </p>
                  {i.description && <p class="small capital-scope">{i.description}</p>}
                  <p class="small muted">
                    {money.length ? money.join(' · ') : 'No new money this year'}
                    {i.prior_authorization > 0 && ` · ${formatMoney(i.prior_authorization)} approved in earlier years`}
                  </p>
                </li>
              );
            })}
          </ul>
          {hits.length > shown && (
            <button type="button" onClick={() => setShown(shown + pageSize())}>
              Show more ({hits.length - shown} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
