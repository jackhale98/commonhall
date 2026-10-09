import { useMemo, useState } from 'preact/hooks';
import { KIND_LABEL, KINDS, type MeetingKind } from '../lib/meetings';
import { href } from '../lib/paths';
import MeetingItem, { type MeetingRow } from './MeetingItem';

export interface CommitteeCard {
  code: string;
  parent: string | null;
  chamber: 'house' | 'senate' | 'joint';
  name: string;
  short: string;
  chair: string | null;
  ranking: string | null;
  subs: number;
  meetings: number;
  upcoming: number;
  bills: number;
}

export type When = 'upcoming' | 'month' | 'all';
const CHAMBERS = [
  { key: '', label: 'All' },
  { key: 'house', label: 'House' },
  { key: 'senate', label: 'Senate' },
  { key: 'joint', label: 'Joint' },
] as const;
const PAGE = 20;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Search and filter committees and their hearings and markups. */
export default function CommitteeExplorer({
  committees,
  meetings,
  now,
  initialWhen = 'upcoming',
}: {
  committees: CommitteeCard[];
  meetings: MeetingRow[];
  now: string;
  /** Opening view: "Coming up" when anything is scheduled, else the last 30 days or the whole Congress. */
  initialWhen?: When;
}) {
  const [q, setQ] = useState('');
  const [chamber, setChamber] = useState('');
  const [committee, setCommittee] = useState('');
  const [kind, setKind] = useState<'' | MeetingKind>('');
  const [when, setWhen] = useState<When>(initialWhen);
  const [shown, setShown] = useState(PAGE);

  const byCode = useMemo(() => new Map(committees.map((c) => [c.code, c])), [committees]);
  const parents = useMemo(
    () => committees.filter((c) => !c.parent).sort((a, b) => a.name.localeCompare(b.name)),
    [committees],
  );
  // A committee filter includes its subcommittees.
  const scope = useMemo(() => {
    if (!committee) return null;
    return new Set([committee, ...committees.filter((c) => c.parent === committee).map((c) => c.code)]);
  }, [committee, committees]);
  const words = norm(q).split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((w) => norm(text).includes(w));
  const monthAgo = new Date(Date.parse(now) - 30 * 86_400_000).toISOString();

  const meetingHits = meetings.filter((m) => {
    if (kind && m.kind !== kind) return false;
    if (when === 'upcoming' && (!m.date || m.date < now)) return false;
    if (when === 'month' && (!m.date || m.date < monthAgo || m.date > now)) return false;
    if (scope && !m.committees.some((c) => scope.has(c))) return false;
    if (chamber && !m.committees.some((c) => byCode.get(c)?.chamber === chamber)) return false;
    if (words.length && !matches(`${m.title ?? ''} ${m.committeeNames.join(' ')} ${m.witnesses.join(' ')}`))
      return false;
    return true;
  });
  // Upcoming reads soonest first; the past reads newest first.
  const sorted =
    when === 'upcoming'
      ? [...meetingHits].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      : [...meetingHits].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  const committeeHits = committees
    .filter((c) => {
      if (chamber && c.chamber !== chamber) return false;
      if (scope && !scope.has(c.code)) return false;
      if (!scope && c.parent && !words.length) return false; // subcommittees appear when searched or chosen
      if (words.length && !matches(`${c.name} ${c.parent ? (byCode.get(c.parent)?.name ?? '') : ''}`)) return false;
      return true;
    })
    .sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || b.meetings - a.meetings || a.name.localeCompare(b.name));

  const reset = () => {
    setQ('');
    setChamber('');
    setCommittee('');
    setKind('');
    setWhen(initialWhen);
    setShown(PAGE);
  };
  const active = Boolean(q || chamber || committee || kind || when !== initialWhen);
  const whenLabel = when === 'upcoming' ? 'coming up' : when === 'month' ? 'in the last 30 days' : 'this Congress';

  return (
    <div class="committee-explorer">
      <div class="explorer-filters" role="search">
        <div class="field explorer-q">
          <label for="ce-q">Search</label>
          <input
            id="ce-q"
            type="search"
            value={q}
            placeholder="Topic or witness"
            onInput={(e) => {
              setQ(e.currentTarget.value);
              setShown(PAGE);
            }}
          />
        </div>
        <div class="field">
          <label for="ce-committee">Committee</label>
          <select
            id="ce-committee"
            value={committee}
            onChange={(e) => {
              setCommittee(e.currentTarget.value);
              setShown(PAGE);
            }}
          >
            <option value="">All committees</option>
            {(['house', 'senate', 'joint'] as const).map((ch) => (
              <optgroup label={ch === 'house' ? 'House' : ch === 'senate' ? 'Senate' : 'Joint'}>
                {parents
                  .filter((p) => p.chamber === ch && (!chamber || chamber === ch))
                  .map((p) => (
                    <option value={p.code}>{p.short}</option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="ce-when">When</label>
          <select
            id="ce-when"
            value={when}
            onChange={(e) => {
              setWhen(e.currentTarget.value as When);
              setShown(PAGE);
            }}
          >
            <option value="upcoming">Coming up</option>
            <option value="month">Last 30 days</option>
            <option value="all">All this Congress</option>
          </select>
        </div>
      </div>
      <div class="explorer-chips">
        <div class="type-chips" role="group" aria-label="Chamber">
          {CHAMBERS.map((c) => (
            <button
              type="button"
              class="chip-button"
              aria-pressed={chamber === c.key}
              onClick={() => {
                setChamber(c.key);
                if (c.key && committee && byCode.get(committee)?.chamber !== c.key) setCommittee('');
                setShown(PAGE);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div class="type-chips" role="group" aria-label="Meeting type">
          <button type="button" class="chip-button" aria-pressed={!kind} onClick={() => setKind('')}>
            All meetings
          </button>
          {KINDS.map((k) => (
            <button
              type="button"
              class="chip-button"
              aria-pressed={kind === k}
              onClick={() => setKind(kind === k ? '' : k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        {active && (
          <button type="button" class="link-button" onClick={reset}>
            Clear filters
          </button>
        )}
      </div>

      <section aria-labelledby="ce-meetings-h">
        <h2 id="ce-meetings-h">
          Hearings and markups {whenLabel} <span class="muted">({sorted.length.toLocaleString()})</span>
        </h2>
        {sorted.length === 0 ? (
          <p class="muted">
            Nothing {whenLabel} matches these filters.
            {when === 'upcoming' && (
              <>
                {' '}
                <button type="button" class="link-button" onClick={() => setWhen('all')}>
                  Show the whole Congress
                </button>
              </>
            )}
          </p>
        ) : (
          <div class="panel">
            <ul class="list meeting-list">
              {sorted.slice(0, shown).map((m) => (
                <MeetingItem m={m} />
              ))}
            </ul>
            {sorted.length > shown && (
              <button type="button" onClick={() => setShown(shown + PAGE)}>
                Show more ({(sorted.length - shown).toLocaleString()} left)
              </button>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="ce-committees-h">
        <h2 id="ce-committees-h">
          {scope ? 'This committee and its subcommittees' : words.length ? 'Matching committees' : 'Committees'}{' '}
          <span class="muted">({committeeHits.length})</span>
        </h2>
        <ul class="grid committee-grid">
          {committeeHits.map((c) => {
            const parent = c.parent ? byCode.get(c.parent) : undefined;
            return (
              <li class="card">
                {parent && <p class="small muted">{parent.short} subcommittee</p>}
                <a class="committee-name" href={href(`committees/${c.code}/`)}>
                  {c.short}
                </a>
                {(c.chair || c.ranking) && (
                  <p class="small muted">
                    {c.chair && <>Chair {c.chair}</>}
                    {c.chair && c.ranking && ' · '}
                    {c.ranking && <>Ranking {c.ranking}</>}
                  </p>
                )}
                <p class="small">
                  {[
                    c.upcoming > 0 ? `${c.upcoming} coming up` : null,
                    `${c.meetings} meeting${c.meetings === 1 ? '' : 's'} this Congress`,
                    c.bills > 0 ? `${c.bills.toLocaleString()} bills referred` : null,
                    !c.parent && c.subs > 0 ? `${c.subs} subcommittees` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
