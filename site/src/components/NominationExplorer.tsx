import { useEffect, useMemo, useState } from 'preact/hooks';
import { NOMINATION_STATUS, type NominationRow, type NominationStatus } from '../lib/executive';
import { formatDate } from '../lib/format';
import { href } from '../lib/paths';

const PAGE = 10;
/** Phones start with fewer, so the page's other sections stay close. */
const PHONE_PAGE = 5;
const pageSize = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? PHONE_PAGE : PAGE;

type Group = 'pending' | 'confirmed' | 'ended' | '';
const GROUPS: { key: Group; label: string }[] = [
  { key: 'pending', label: 'Awaiting the Senate' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'ended', label: 'Withdrawn, returned or rejected' },
  { key: '', label: 'All nominations' },
];
const inGroup = (s: NominationStatus, g: Group) =>
  g === '' ||
  (g === 'pending' && NOMINATION_STATUS[s].pending) ||
  (g === 'confirmed' && s === 'confirmed') ||
  (g === 'ended' && (s === 'withdrawn' || s === 'returned' || s === 'rejected'));
/** Pending nominations closest to a vote first. */
const STAGE: NominationStatus[] = ['floor', 'on_calendar', 'reported', 'in_committee', 'received'];

interface Props {
  /** Prerendered rows (the first page of nominations awaiting the Senate). */
  initial: NominationRow[];
  /** Agencies with nominations, most first. */
  agencies: string[];
}

/**
 * Civilian nominations with search (nominee, position, agency) and filters
 * (where it stands, agency). Starts from the prerendered rows and loads the full
 * list (nominations.json, built with the site) when it comes into view.
 */
export default function NominationExplorer({ initial, agencies }: Props) {
  const [rows, setRows] = useState<NominationRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>('pending');
  const [agency, setAgency] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setShown(pageSize());
    setMounted(true);
    fetch(href('executive/nominations.json'))
      .then((r) => (r.ok ? (r.json() as Promise<NominationRow[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setRows)
      .catch(() => setFailed(true));
  }, []);

  const all = rows ?? initial;
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = all.filter((n) => {
      if (!inGroup(n.s, group)) return false;
      if (agency && n.o !== agency) return false;
      if (words.length === 0) return true;
      const text = `${n.w} ${n.p ?? ''} ${n.o ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    if (group === 'pending')
      return [...list].sort((a, b) => STAGE.indexOf(a.s) - STAGE.indexOf(b.s) || (b.r ?? '').localeCompare(a.r ?? ''));
    return [...list].sort((a, b) => (b.d ?? '').localeCompare(a.d ?? ''));
  }, [all, q, group, agency]);

  const set =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setShown(pageSize());
    };
  const active = q || group !== 'pending' || agency;
  const reset = () => {
    setQ('');
    setGroup('pending');
    setAgency('');
    setShown(pageSize());
  };
  const groupLabel = GROUPS.find((g) => g.key === group)!.label;

  return (
    <div>
      <form class="explorer-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <div class="explorer-query">
          <label for="nom-q" class="visually-hidden">
            Search nominations
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="nom-q"
            type="search"
            value={q}
            placeholder="Name or position"
            onInput={(e) => set(setQ)(e.currentTarget.value)}
          />
        </div>
        <div class="explorer-filters" role="group" aria-label="Filters">
          <label for="nom-group" class="visually-hidden">
            Where it stands
          </label>
          <select
            id="nom-group"
            value={group}
            class={group !== 'pending' ? 'is-set' : ''}
            onChange={(e) => set(setGroup)(e.currentTarget.value as Group)}
          >
            {GROUPS.map((g) => (
              <option value={g.key}>{g.label}</option>
            ))}
          </select>
          <label for="nom-agency" class="visually-hidden">
            Agency
          </label>
          <select
            id="nom-agency"
            value={agency}
            class={agency ? 'is-set' : ''}
            onChange={(e) => set(setAgency)(e.currentTarget.value)}
          >
            <option value="">Any agency</option>
            {agencies.map((a) => (
              <option value={a}>{a}</option>
            ))}
          </select>
          {active && (
            <button type="button" class="link-button clear-filters" onClick={reset}>
              Clear
            </button>
          )}
        </div>
      </form>

      <p class="small muted" aria-live="polite">
        {rows === null && !failed
          ? 'Loading every nomination…'
          : `${hits.length.toLocaleString()} · ${groupLabel.toLowerCase()}${agency ? ` · ${agency}` : ''}`}
        {failed && ' Showing the first nominations only; the full list didn’t load.'}
      </p>

      {hits.length === 0 ? (
        <p class="muted">
          No nominations match.{' '}
          <button type="button" class="link-button" onClick={reset}>
            Clear filters
          </button>
        </p>
      ) : (
        <div class="panel">
          <ul class={`list nom-list trimmable${mounted ? ' is-live' : ''}`}>
            {hits.slice(0, shown).map((n) => (
              <li key={n.u + n.w}>
                <p class="meta">
                  <span class="chip">{NOMINATION_STATUS[n.s].label}</span>
                  {n.o && ` · ${n.o}`}
                  {n.s === 'confirmed' ? ` · confirmed ${formatDate(n.d)}` : n.r && ` · received ${formatDate(n.r)}`}
                </p>
                <p class="nom-name">
                  <a href={n.u} rel="noopener">
                    {n.w}
                  </a>
                </p>
                {n.p && <p class="small">{n.p}</p>}
                <p class="small muted">
                  {n.v ? (
                    <a href={n.v[0]}>
                      Senate vote {n.v[1]}–{n.v[2]}
                    </a>
                  ) : n.s === 'confirmed' && /voice vote|unanimous consent/i.test(n.a ?? '') ? (
                    'By voice vote or unanimous consent'
                  ) : (
                    n.a && `${formatDate(n.d)}: ${n.a}`
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
