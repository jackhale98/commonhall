import { useEffect, useMemo, useState } from 'preact/hooks';
import { href } from '../lib/paths';
import { passed, type VoteRow } from '../lib/votes';
import VoteList, { type VoteListItemData } from './VoteList';

const PAGE = 10;
/** Phones start with fewer, so the page's other sections stay close. */
const PHONE_PAGE = 5;
const pageSize = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? PHONE_PAGE : PAGE;

/** A margin this small or smaller counts as close. */
const CLOSE = 10;

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

const toItem = (r: VoteRow): VoteListItemData => ({
  id: r.i,
  chamber: r.c,
  roll_number: r.r,
  date: r.d,
  question: r.q,
  result: r.res,
  yea_total: r.y,
  nay_total: r.n,
  bill: r.b,
  subject: r.s,
});

/**
 * Every roll call this Congress with search (bill, nominee, question) and filters
 * (chamber, outcome, close votes). Starts from the prerendered latest votes and loads
 * the full list (votes.json, built with the site) on mount.
 */
export default function VoteExplorer({ initial }: { initial: VoteRow[] }) {
  const [rows, setRows] = useState<VoteRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [chamber, setChamber] = useState('');
  const [outcome, setOutcome] = useState('');
  const [close, setClose] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setShown(pageSize());
    setMounted(true);
    fetch(href('votes/votes.json'))
      .then((r) => (r.ok ? (r.json() as Promise<VoteRow[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setRows)
      .catch(() => setFailed(true));
  }, []);

  const all = rows ?? initial;
  const hits = useMemo(() => {
    const terms = words(q);
    return all.filter((r) => {
      if (chamber && r.c !== chamber) return false;
      if (outcome === 'passed' && !passed(r.res)) return false;
      if (outcome === 'failed' && passed(r.res)) return false;
      if (close && (r.y + r.n === 0 || Math.abs(r.y - r.n) > CLOSE)) return false;
      if (!terms.length) return true;
      const text =
        `${r.b ?? ''} ${(r.b ?? '').replace(/\W/g, '')} ${r.s ?? ''} ${r.q ?? ''} ${r.res ?? ''} roll ${r.r}`.toLowerCase();
      return terms.every((w) => text.includes(w));
    });
  }, [all, q, chamber, outcome, close]);

  const active = q || chamber || outcome || close;
  const set =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setShown(pageSize());
    };
  const reset = () => {
    setQ('');
    setChamber('');
    setOutcome('');
    setClose(false);
    setShown(pageSize());
  };

  return (
    <div>
      <form class="explorer-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <div class="explorer-query">
          <label for="vote-q" class="visually-hidden">
            Search votes
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="vote-q"
            type="search"
            value={q}
            placeholder="Bill, nominee or topic"
            onInput={(e) => set(setQ)(e.currentTarget.value)}
          />
        </div>
        <div class="explorer-filters" role="group" aria-label="Filters">
          <label for="vote-chamber" class="visually-hidden">
            Chamber
          </label>
          <select
            id="vote-chamber"
            value={chamber}
            class={chamber ? 'is-set' : ''}
            onChange={(e) => set(setChamber)(e.currentTarget.value)}
          >
            <option value="">House and Senate</option>
            <option value="house">House</option>
            <option value="senate">Senate</option>
          </select>
          <label for="vote-outcome" class="visually-hidden">
            Outcome
          </label>
          <select
            id="vote-outcome"
            value={outcome}
            class={outcome ? 'is-set' : ''}
            onChange={(e) => set(setOutcome)(e.currentTarget.value)}
          >
            <option value="">Any outcome</option>
            <option value="passed">Passed or agreed to</option>
            <option value="failed">Failed or rejected</option>
          </select>
          <button type="button" class="filter-toggle" aria-pressed={close} onClick={() => set(setClose)(!close)}>
            Close votes
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
          ? `The latest ${initial.length} roll calls`
          : `${hits.length.toLocaleString()} roll call${hits.length === 1 ? '' : 's'}${close ? ` decided by ${CLOSE} votes or fewer` : ''}`}
        {failed && '; the full list didn’t load.'}
      </p>

      {hits.length === 0 ? (
        <p class="muted">
          No votes match.{' '}
          <button type="button" class="link-button" onClick={reset}>
            Clear filters
          </button>
        </p>
      ) : (
        <div class={`panel trimmable${mounted ? ' is-live' : ''}`}>
          <VoteList votes={hits.slice(0, shown).map(toItem)} />
          {hits.length > shown && (
            <button type="button" onClick={() => setShown(shown + 20)}>
              Show more ({(hits.length - shown).toLocaleString()} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
