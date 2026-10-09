import { useEffect, useRef, useState } from 'preact/hooks';
import { rpc, selectWithCount, type Params } from '../lib/rest';
import { LOCAL_MATTER_COLUMNS, type LocalMatter } from '../lib/types';
import LocalMatterItem from './LocalMatterItem';

const PAGE = 20;

export interface MatterFacets {
  types: { value: string; count: number }[];
  statuses: { value: string; count: number }[];
  sponsors: { id: string; name: string }[];
}

interface Filters {
  q: string;
  type: string;
  status: string;
  sponsor: string;
}

const NONE: Filters = { q: '', type: '', status: '', sponsor: '' };

/** Council matters with search, filters (type, status, sponsor) and paging. Starts from the prerendered list. */
export default function LocalMatters({
  initial,
  facets,
  local = false,
}: {
  initial: LocalMatter[];
  facets: MatterFacets;
  local?: boolean;
}) {
  const [matters, setMatters] = useState(initial);
  const [filters, setFilters] = useState<Filters>(NONE);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  // Counts given the other filters; starts from the build's overall counts.
  const [counts, setCounts] = useState({ types: facets.types, statuses: facets.statuses });
  const first = useRef(true);
  const active = Boolean(filters.q || filters.type || filters.status || filters.sponsor);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const term = filters.q.trim();
    if (local) {
      // Demo build: filter the bundled list (sponsor filtering needs the database).
      const words = term.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = initial.filter(
        (m) =>
          words.every((w) => `${m.file_number} ${m.title}`.toLowerCase().includes(w)) &&
          (!filters.type || m.type === filters.type) &&
          (!filters.status || m.status === filters.status),
      );
      setMatters(hits.slice((page - 1) * PAGE, page * PAGE));
      setTotal(hits.length);
      return;
    }
    const where: Params = {
      type: filters.type ? `eq.${filters.type}` : undefined,
      status: filters.status ? `eq.${filters.status}` : undefined,
    };
    // Sponsor: an inner join on local_matter_sponsors, filtered to that councilor.
    const select = filters.sponsor
      ? `${LOCAL_MATTER_COLUMNS},local_matter_sponsors!inner(official_id)`
      : LOCAL_MATTER_COLUMNS;
    if (filters.sponsor) where['local_matter_sponsors.official_id'] = `eq.${filters.sponsor}`;
    setLoading(true);
    const request = term
      ? rpc<LocalMatter[]>(
          'search_local_matters',
          { p_city: 'boston', q: term, max_results: 200 },
          { select, ...where },
        ).then((rows) => ({ rows: rows.slice((page - 1) * PAGE, page * PAGE), count: rows.length }))
      : selectWithCount<LocalMatter>('local_matters', {
          select,
          city: 'eq.boston',
          ...where,
          order: 'latest_action_date.desc.nullslast,last_modified.desc',
          limit: PAGE,
          offset: (page - 1) * PAGE,
        });
    request
      .then(({ rows, count }) => {
        setMatters(rows);
        setTotal(count);
      })
      .catch(() => {
        setMatters([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => {
    if (local) return;
    rpc<{ facet: string; value: string; n: number }[]>('local_matter_facets', {
      p_city: 'boston',
      p_type: filters.type || null,
      p_status: filters.status || null,
      p_sponsor: filters.sponsor || null,
      p_q: filters.q.trim() || null,
    })
      .then((rows) => {
        const pick = (facet: string) =>
          rows
            .filter((r) => r.facet === facet)
            .map((r) => ({ value: r.value, count: r.n }))
            .sort((a, b) => b.count - a.count);
        setCounts({ types: pick('type'), statuses: pick('status') });
      })
      .catch(() => undefined);
  }, [filters]);

  // Keep the chosen type and status visible even when their count drops to zero.
  const withChosen = (list: { value: string; count: number }[], chosen: string) =>
    chosen && !list.some((x) => x.value === chosen) ? [...list, { value: chosen, count: 0 }] : list;
  const types = withChosen(counts.types, filters.type);
  const statuses = withChosen(counts.statuses, filters.status);
  const set = (patch: Partial<Filters>) => {
    setPage(1);
    setFilters((f) => ({ ...f, ...patch }));
  };

  // Council types read "Council Legislative Resolution"; the menu drops the prefix.
  const short = (t: string) => t.replace(/^Council /, '');
  return (
    <div>
      <form
        class="explorer-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: String(new FormData(e.currentTarget as HTMLFormElement).get('q') ?? '') });
        }}
      >
        <div class="explorer-query">
          <label for="lm-q" class="visually-hidden">
            Search council matters
          </label>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input id="lm-q" name="q" type="search" placeholder="Search matters" />
          <button type="submit" class="primary">
            Search
          </button>
        </div>
        <div class="explorer-filters matter-filters" role="group" aria-label="Filters">
          {types.length > 0 && (
            <>
              <label for="lm-type" class="visually-hidden">
                Type
              </label>
              <select
                id="lm-type"
                value={filters.type}
                class={filters.type ? 'is-set' : ''}
                onChange={(e) => set({ type: e.currentTarget.value })}
              >
                <option value="">All types</option>
                {types.map((t) => (
                  <option value={t.value}>
                    {short(t.value)} ({t.count.toLocaleString()})
                  </option>
                ))}
              </select>
            </>
          )}
          <label for="lm-status" class="visually-hidden">
            Status
          </label>
          <select
            id="lm-status"
            value={filters.status}
            class={filters.status ? 'is-set' : ''}
            onChange={(e) => set({ status: e.currentTarget.value })}
          >
            <option value="">Any status</option>
            {statuses.map((s) => (
              <option value={s.value}>
                {s.value} ({s.count.toLocaleString()})
              </option>
            ))}
          </select>
          {!local && facets.sponsors.length > 0 && (
            <>
              <label for="lm-sponsor" class="visually-hidden">
                Sponsor
              </label>
              <select
                id="lm-sponsor"
                value={filters.sponsor}
                class={filters.sponsor ? 'is-set' : ''}
                onChange={(e) => set({ sponsor: e.currentTarget.value })}
              >
                <option value="">Any councilor</option>
                {facets.sponsors.map((s) => (
                  <option value={s.id}>{s.name}</option>
                ))}
              </select>
            </>
          )}
          {active && (
            <button
              type="button"
              class="link-button clear-filters"
              onClick={(e) => {
                (e.currentTarget.form as HTMLFormElement).reset();
                set(NONE);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>
      {total !== null && (
        <p class="small muted" aria-live="polite">
          {total.toLocaleString()} {total === 1 ? 'matter' : 'matters'}
          {filters.q && total >= 200 && ' (top 200 search results)'}
        </p>
      )}
      {matters.length === 0 ? (
        <p class="muted">{loading ? 'Loading…' : 'No matters match these filters.'}</p>
      ) : (
        <ul class="list" aria-busy={loading}>
          {matters.map((m) => (
            <LocalMatterItem matter={m} />
          ))}
        </ul>
      )}
      {total !== null && total > PAGE && (
        <nav class="pager" aria-label="Pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {Math.ceil(total / PAGE)}
          </span>
          <button type="button" disabled={page >= Math.ceil(total / PAGE)} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
