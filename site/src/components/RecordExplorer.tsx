import { useEffect, useMemo, useState } from 'preact/hooks';

const PAGE = 10;
/** Phones get half a page, so the sections below stay close. */
const pageSize = () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 40rem)').matches ? 5 : PAGE);

export interface RecordRow {
  id: string;
  /** "No. 658 · Sep 8, 2026 · Maura Healey". */
  meta: string;
  title: string;
  href: string;
  /** A second line: what it revokes, the dissents. */
  note?: string;
  /** Chips after the meta: "Discussion open". */
  tags?: string[];
  /** The value the menu filters on: a year, a governor. */
  group: string;
  /** A flag the toggle filters on (a decision with a dissent). */
  flag?: boolean;
}

interface Props {
  rows: RecordRow[];
  /** "Search orders". */
  searchLabel: string;
  placeholder: string;
  /** "Any year", "Any governor". */
  groupLabel: string;
  /** Toggle label ("With a dissent"); no toggle without one. */
  flagLabel?: string;
  /** "order" / "decision", for the count. */
  noun: [string, string];
}

/**
 * A searchable, pageable list of records built with the page (governors' orders,
 * court decisions): search the title and meta, filter by a group (year, governor)
 * and an optional flag. Everything is in the page, so it works without requests.
 */
export default function RecordExplorer({ rows, searchLabel, placeholder, groupLabel, flagLabel, noun }: Props) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [flag, setFlag] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE);
  useEffect(() => setSize(pageSize()), []);

  const groups = useMemo(() => [...new Set(rows.map((r) => r.group).filter(Boolean))], [rows]);
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      if (group && r.group !== group) return false;
      if (flag && !r.flag) return false;
      const text = `${r.title} ${r.meta} ${r.note ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [rows, q, group, flag]);
  useEffect(() => setPage(1), [q, group, flag]);
  const pages = Math.max(1, Math.ceil(hits.length / size));
  const shown = hits.slice((page - 1) * size, page * size);
  const id = noun[0].replace(/\W/g, '');

  return (
    <div>
      <form class="explorer-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <div class="explorer-query">
          <label for={`rx-q-${id}`} class="visually-hidden">
            {searchLabel}
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id={`rx-q-${id}`}
            type="search"
            placeholder={placeholder}
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
          />
        </div>
        <div class="explorer-filters">
          {groups.length > 1 && (
            <>
              <label for={`rx-g-${id}`} class="visually-hidden">
                {groupLabel}
              </label>
              <select
                id={`rx-g-${id}`}
                value={group}
                class={group ? 'is-set' : ''}
                onChange={(e) => setGroup(e.currentTarget.value)}
              >
                <option value="">{groupLabel}</option>
                {groups.map((g) => (
                  <option value={g}>{g}</option>
                ))}
              </select>
            </>
          )}
          {flagLabel && (
            <button type="button" class="filter-toggle" aria-pressed={flag} onClick={() => setFlag(!flag)}>
              {flagLabel}
            </button>
          )}
        </div>
      </form>
      <p class="small muted" aria-live="polite">
        {hits.length.toLocaleString()} {hits.length === 1 ? noun[0] : noun[1]}
      </p>
      {shown.length === 0 ? (
        <p class="muted">Nothing matches.</p>
      ) : (
        <div class="panel">
          <ul class="list">
            {shown.map((r) => (
              <li class="state-bill" key={r.id}>
                <div>
                  <p class="meta">
                    {r.meta}
                    {r.tags?.map((t) => (
                      <>
                        {' '}
                        <span class="status-chip">{t}</span>
                      </>
                    ))}
                  </p>
                  <p class="bill-title-sm">
                    <a href={r.href}>{r.title}</a>
                  </p>
                  {r.note && <p class="meta">{r.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pages > 1 && (
        <nav class="pager" aria-label="Pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
