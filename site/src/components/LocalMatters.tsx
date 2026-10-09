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

  const set = (patch: Partial<Filters>) => {
    setPage(1);
    setFilters((f) => ({ ...f, ...patch }));
  };

  // Council types read "Council Legislative Resolution"; the chips drop the prefix.
  const short = (t: string) => t.replace(/^Council /, '');
  return (
    <div>
      {facets.types.length > 1 && (
        <div class="type-chips" role="group" aria-label="Filter by type">
          <button type="button" class="chip-button" aria-pressed={!filters.type} onClick={() => set({ type: '' })}>
            All
          </button>
          {facets.types.slice(0, 7).map((t) => (
            <button
              type="button"
              class="chip-button"
              aria-pressed={filters.type === t.value}
              onClick={() => set({ type: filters.type === t.value ? '' : t.value })}
            >
              {short(t.value)} <span class="muted">{t.count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
      <form
        class="toolbar matter-filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: String(new FormData(e.currentTarget as HTMLFormElement).get('q') ?? '') });
        }}
      >
        <div class="field" style={{ flexBasis: '16rem' }}>
          <label for="lm-q">Search</label>
          <input id="lm-q" name="q" type="search" placeholder="Words or docket number, e.g. bike lanes" />
        </div>
        <div class="field">
          <label for="lm-type">Type</label>
          <select id="lm-type" value={filters.type} onChange={(e) => set({ type: e.currentTarget.value })}>
            <option value="">All types</option>
            {facets.types.map((t) => (
              <option value={t.value}>
                {t.value} ({t.count.toLocaleString()})
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="lm-status">Status</label>
          <select id="lm-status" value={filters.status} onChange={(e) => set({ status: e.currentTarget.value })}>
            <option value="">Any status</option>
            {facets.statuses.map((s) => (
              <option value={s.value}>
                {s.value} ({s.count.toLocaleString()})
              </option>
            ))}
          </select>
        </div>
        {!local && facets.sponsors.length > 0 && (
          <div class="field">
            <label for="lm-sponsor">Sponsor</label>
            <select id="lm-sponsor" value={filters.sponsor} onChange={(e) => set({ sponsor: e.currentTarget.value })}>
              <option value="">Any councilor</option>
              {facets.sponsors.map((s) => (
                <option value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
        <button type="submit">Search</button>
        {active && (
          <button
            type="button"
            class="link-button"
            onClick={(e) => {
              (e.currentTarget.form as HTMLFormElement).reset();
              set(NONE);
            }}
          >
            Clear filters
          </button>
        )}
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
