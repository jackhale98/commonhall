import { useEffect, useRef, useState } from 'preact/hooks';
import { rpc, selectWithCount } from '../lib/rest';
import { LOCAL_MATTER_COLUMNS, type LocalMatter } from '../lib/types';
import LocalMatterItem from './LocalMatterItem';

const PAGE = 20;

/** Recent council matters (prerendered), with search and paging. */
export default function LocalMatters({ initial, local = false }: { initial: LocalMatter[]; local?: boolean }) {
  const [matters, setMatters] = useState(initial);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const term = q.trim();
    if (local) {
      const words = term.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = initial.filter((m) => words.every((w) => `${m.file_number} ${m.title}`.toLowerCase().includes(w)));
      setMatters(hits.slice((page - 1) * PAGE, page * PAGE));
      setTotal(hits.length);
      return;
    }
    setLoading(true);
    const request = term
      ? rpc<LocalMatter[]>(
          'search_local_matters',
          { p_city: 'boston', q: term, max_results: 200 },
          { select: LOCAL_MATTER_COLUMNS },
        ).then((rows) => ({ rows: rows.slice((page - 1) * PAGE, page * PAGE), count: rows.length }))
      : selectWithCount<LocalMatter>('local_matters', {
          select: LOCAL_MATTER_COLUMNS,
          city: 'eq.boston',
          order: 'latest_action_date.desc.nullslast,last_modified.desc',
          limit: PAGE,
          offset: (page - 1) * PAGE,
        });
    request
      .then(({ rows, count }) => {
        setMatters(rows);
        setTotal(count);
      })
      .catch(() => setTotal(0))
      .finally(() => setLoading(false));
  }, [q, page]);

  return (
    <div>
      <form
        class="toolbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(String(new FormData(e.currentTarget as HTMLFormElement).get('q') ?? ''));
        }}
      >
        <div class="field" style={{ flexBasis: '18rem' }}>
          <label for="lm-q">Search council matters</label>
          <input id="lm-q" name="q" type="search" placeholder="Words or docket number, e.g. bike lanes" />
        </div>
        <button type="submit">Search</button>
      </form>
      {total !== null && (
        <p class="small muted" aria-live="polite">
          {total.toLocaleString()} {total === 1 ? 'matter' : 'matters'}
        </p>
      )}
      {matters.length === 0 ? (
        <p class="muted">{loading ? 'Loading…' : 'No matters found.'}</p>
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
