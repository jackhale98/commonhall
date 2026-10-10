import { useMemo, useState } from 'preact/hooks';
import { stateLegislatorHref } from '../lib/paths';
import FollowButton from './FollowButton';

export interface LegislatorRow {
  id: string;
  name: string;
  party: string | null;
  district: string | null;
  chamber: string;
  url: string | null;
}

const PAGE = 10;

/** "Democratic" → "Democrat", unknown → "No party listed"; short enough for a phone row. */
const partyShort = (p: string | null) => (!p ? 'No party listed' : p === 'Democratic' ? 'Democrat' : p);

/**
 * A state's legislators as compact rows: search by name or district, chamber
 * chips, 10 at a time. Replaces the long per-chamber card lists.
 */
export default function StateLegislators({
  legislators,
  chambers,
}: {
  legislators: LegislatorRow[];
  /** Chamber keys and labels present in this state, e.g. upper → Senate. */
  chambers: { key: string; label: string; count: number }[];
}) {
  const [q, setQ] = useState('');
  const [chamber, setChamber] = useState('');
  const [shown, setShown] = useState(PAGE);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    return legislators.filter(
      (l) =>
        (!chamber || l.chamber === chamber) &&
        (!term ||
          l.name.toLowerCase().includes(term) ||
          (l.district ?? '').toLowerCase().includes(term) ||
          (l.party ?? '').toLowerCase().startsWith(term)),
    );
  }, [legislators, q, chamber]);
  const label = new Map(chambers.map((c) => [c.key, c.label]));

  return (
    <div>
      <form class="explorer-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <div class="explorer-query">
          <label for="leg-q" class="visually-hidden">
            Search legislators
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="leg-q"
            type="search"
            value={q}
            placeholder="Name or district"
            onInput={(e) => {
              setQ(e.currentTarget.value);
              setShown(PAGE);
            }}
          />
        </div>
        {chambers.length > 1 && (
          <div class="type-chips" role="group" aria-label="Chamber">
            <button
              type="button"
              class="chip-button"
              aria-pressed={!chamber}
              onClick={() => {
                setChamber('');
                setShown(PAGE);
              }}
            >
              Both chambers
            </button>
            {chambers.map((c) => (
              <button
                type="button"
                class="chip-button"
                aria-pressed={chamber === c.key}
                onClick={() => {
                  setChamber(chamber === c.key ? '' : c.key);
                  setShown(PAGE);
                }}
              >
                {c.label} <span class="muted">{c.count}</span>
              </button>
            ))}
          </div>
        )}
      </form>
      <p class="small muted" aria-live="polite">
        {hits.length.toLocaleString()} {hits.length === 1 ? 'legislator' : 'legislators'}
      </p>
      {hits.length > 0 && (
        <div class="panel">
          <ul class="list legislator-list">
            {hits.slice(0, shown).map((l) => (
              <li key={l.id} class="legislator">
                <span class="legislator-text">
                  <a href={stateLegislatorHref(l.id)}>{l.name}</a>
                  <span class="small muted">
                    {partyShort(l.party)}
                    {chambers.length > 1 && ` · ${label.get(l.chamber) ?? ''}`}
                    {l.district && ` · ${/^\d+$/.test(l.district) ? `District ${l.district}` : l.district}`}
                  </span>
                </span>
                <FollowButton targetType="state_legislator" targetId={l.id} label={l.name} />
              </li>
            ))}
          </ul>
          {hits.length > shown && (
            <button type="button" onClick={() => setShown(shown + PAGE)}>
              Show more ({(hits.length - shown).toLocaleString()} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
