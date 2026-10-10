import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatMoney } from '../lib/finance';
import type { ProjectRow } from '../lib/city';
import { CAPITAL_STAGES, capitalStage } from '../lib/local';
import { capitalProjectHref } from '../lib/paths';

const PAGE = 10;

/** Five dots, filled up to the project's stage (none for annual programs). */
function StageDots({ status }: { status: string | null }) {
  const stage = capitalStage(status);
  if (stage === null) return null;
  return (
    <span class="stage-dots" aria-hidden="true">
      {CAPITAL_STAGES.map((_, i) => (
        <span class={i <= stage ? 'on' : ''} />
      ))}
    </span>
  );
}
const pageSize = () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? 5 : PAGE);

interface Props {
  /** Prerendered rows: the largest projects. */
  initial: ProjectRow[];
  /** The city's capital.json, with every project. */
  jsonUrl: string;
  departments: string[];
  /** Neighborhoods (Boston) or categories (Worcester). */
  areas: string[];
  areaLabel: string;
  statuses: string[];
  /** e.g. FY27, the plan's first year or the budget's year. */
  yearLabel: string;
  /** e.g. "spent through FY25", when projects have whole-project totals. */
  spentText?: string;
}

/**
 * A city's capital projects: search (name, description, department), filters
 * (department, area, stage where the city gives stages), largest first. Loads the
 * full list (the city's capital.json, built with the site) when it comes into view.
 * Whole-project totals and stages show where the city publishes them (Boston's
 * plan); otherwise each project shows this year's money (Worcester's budget).
 */
export default function CapitalExplorer({
  initial,
  jsonUrl,
  departments,
  areas,
  areaLabel,
  statuses,
  yearLabel,
  spentText,
}: Props) {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [hood, setHood] = useState('');
  const [status, setStatus] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setShown(pageSize());
    setMounted(true);
    fetch(jsonUrl)
      .then((r) => (r.ok ? (r.json() as Promise<ProjectRow[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setRows)
      .catch(() => undefined);
  }, [jsonUrl]);

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
  const hasTotals = all.some((p) => p.t !== null);
  const total = hits.reduce((n, p) => n + (hasTotals ? (p.t ?? 0) : p.y), 0);
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
          {areas.length > 0 && select('cap-hood', areaLabel, hood, areas, set(setHood))}
          {statuses.length > 0 && select('cap-status', 'Any stage', status, statuses, set(setStatus))}
          {active && (
            <button type="button" class="link-button clear-filters" onClick={reset}>
              Clear
            </button>
          )}
        </div>
      </form>
      <p class="small muted" aria-live="polite">
        {hits.length.toLocaleString()} {hits.length === 1 ? 'project' : 'projects'} · {formatMoney(total)}{' '}
        {hasTotals ? 'in total' : `this year`}
      </p>
      {hits.length > 0 && (
        <div class="panel">
          <ul class={`list capital-list trimmable${mounted ? ' is-live' : ''}`}>
            {hits.slice(0, shown).map((p) => (
              <li key={p.i}>
                <p class="meta">{[p.d, p.h].filter(Boolean).join(' · ')}</p>
                <p class="capital-name">
                  <a href={capitalProjectHref(p.i)}>
                    <strong>{p.n}</strong>
                  </a>
                </p>
                {p.w && <p class="small capital-scope">{p.w}</p>}
                {p.s && (
                  <p class="small capital-stage">
                    <StageDots status={p.s} />
                    {p.s}
                  </p>
                )}
                {p.t !== null ? (
                  <>
                    <div class="funding-bar compact" aria-hidden="true">
                      {(p.p ?? 0) > 0 && <span class="fund-1" style={{ flex: `${p.p} 1 0` }} />}
                      <span class="fund-rest" style={{ flex: `${Math.max(0, p.t - (p.p ?? 0))} 1 0` }} />
                    </div>
                    <p class="small muted">
                      <strong>{formatMoney(p.p ?? 0)}</strong> {spentText} of {formatMoney(p.t)}
                      {p.y > 0 && (
                        <>
                          {' '}
                          · {formatMoney(p.y)} planned in {yearLabel}
                        </>
                      )}
                    </p>
                  </>
                ) : (
                  <p class="small muted">
                    {p.y > 0 ? (
                      <>
                        <strong>{formatMoney(p.y)}</strong> in borrowing and cash, {yearLabel}
                      </>
                    ) : (
                      `No new money in ${yearLabel}`
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
