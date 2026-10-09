import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatDate } from '../lib/format';
import type { ZbaRow } from '../lib/local';
import { href } from '../lib/paths';

const PAGE = 10;
const pageSize = () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? 5 : PAGE);

/** Approved reads as passed, denied as stopped; anything else stays neutral. */
const decisionClass = (d: string) => (d.startsWith('Approved') ? 'status-law' : d === 'Denied' ? 'status-vetoed' : '');

type Mode = 'upcoming' | 'decided';

interface Props {
  /** Prerendered rows: the next hearings. */
  initial: ZbaRow[];
  neighborhoods: string[];
  /** YYYY-MM-DD at build time; the browser's own date replaces it. */
  today: string;
}

/**
 * Zoning Board of Appeal cases: upcoming hearings (soonest first) or decisions of
 * the last year (latest first), searchable by address, neighborhood or project,
 * filtered by neighborhood. Loads the full list (zoning.json) when it comes into view.
 */
export default function ZoningExplorer({ initial, neighborhoods, today: buildDay }: Props) {
  const [rows, setRows] = useState<ZbaRow[] | null>(null);
  const [mode, setMode] = useState<Mode>('upcoming');
  const [q, setQ] = useState('');
  const [hood, setHood] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [mounted, setMounted] = useState(false);
  const [today, setToday] = useState(buildDay);

  useEffect(() => {
    setShown(pageSize());
    setMounted(true);
    setToday(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
    fetch(href('boston/zoning.json'))
      .then((r) => (r.ok ? (r.json() as Promise<ZbaRow[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setRows)
      .catch(() => undefined);
  }, []);

  const all = rows ?? initial;
  const { upcoming, decided } = useMemo(
    () => ({
      upcoming: all.filter((z) => z.h && z.h >= today).sort((a, b) => a.h!.localeCompare(b.h!)),
      decided: all.filter((z) => z.d && (!z.h || z.h < today)),
    }),
    [all, today],
  );
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (mode === 'upcoming' ? upcoming : decided).filter((z) => {
      if (hood && z.n !== hood) return false;
      const text = `${z.a ?? ''} ${z.n ?? ''} ${z.w ?? ''} ${z.i}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [upcoming, decided, mode, q, hood]);
  const reset = (fn: () => void) => {
    fn();
    setShown(pageSize());
  };
  const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  return (
    <div>
      <form class="explorer-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <div class="explorer-query">
          <label for="zba-q" class="visually-hidden">
            Search zoning appeals
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="zba-q"
            type="search"
            value={q}
            placeholder="Address or project"
            onInput={(e) => reset(() => setQ(e.currentTarget.value))}
          />
        </div>
        <div class="type-chips" role="group" aria-label="Which cases">
          <button
            type="button"
            class="chip-button"
            aria-pressed={mode === 'upcoming'}
            onClick={() => reset(() => setMode('upcoming'))}
          >
            Upcoming <span class="muted">{upcoming.length}</span>
          </button>
          <button
            type="button"
            class="chip-button"
            aria-pressed={mode === 'decided'}
            onClick={() => reset(() => setMode('decided'))}
          >
            Decided <span class="muted">{decided.length}</span>
          </button>
        </div>
        <div class="explorer-filters matter-filters" role="group" aria-label="Filters">
          <label for="zba-hood" class="visually-hidden">
            Neighborhood
          </label>
          <select
            id="zba-hood"
            value={hood}
            class={hood ? 'is-set' : ''}
            onChange={(e) => reset(() => setHood(e.currentTarget.value))}
          >
            <option value="">Any neighborhood</option>
            {neighborhoods.map((n) => (
              <option value={n}>{n}</option>
            ))}
          </select>
        </div>
      </form>
      <p class="small muted" aria-live="polite">
        {mode === 'upcoming'
          ? count(hits.length, 'hearing scheduled', 'hearings scheduled')
          : count(hits.length, 'decision in the last year', 'decisions in the last year')}
      </p>
      {hits.length > 0 && (
        <div class="panel">
          <ul class={`list zoning-list trimmable${mounted ? ' is-live' : ''}`}>
            {hits.slice(0, shown).map((z) => (
              <li key={z.i}>
                <p class="meta">
                  {[z.h && `${mode === 'upcoming' ? 'Hearing' : 'Heard'} ${formatDate(z.h)}`, z.n, z.t]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p>
                  <strong>{z.a ?? z.i}</strong>
                  {z.d && (
                    <>
                      {' '}
                      <span class={`status-chip ${decisionClass(z.d)}`}>{z.d}</span>
                    </>
                  )}
                </p>
                {z.w && <p class="small zoning-desc">{z.w}</p>}
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
