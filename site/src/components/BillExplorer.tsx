import { useEffect, useRef, useState } from 'preact/hooks';
import { BILL_STATUSES, STATUS_LABELS } from '@civic/congress-client/status';
import { memberHref } from '../lib/paths';
import { RestError, rpc, selectWithCount, type Params } from '../lib/rest';
import { BILL_LIST_COLUMNS, type BillListItem as Bill } from '../lib/types';
import BillListItem from './BillListItem';

interface Props {
  congress: number;
  initial: Bill[];
  policyAreas: string[];
}

interface Filters {
  q: string;
  chamber: '' | 'house' | 'senate';
  status: string;
  policy: string;
  party: '' | 'D' | 'R' | 'I';
  /** Bioguide id: bills this member sponsored. */
  sponsor: string;
  sort: 'latest' | 'introduced';
  page: number;
}

const PAGE_SIZE = 25;
const EMPTY: Filters = { q: '', chamber: '', status: '', policy: '', party: '', sponsor: '', sort: 'latest', page: 1 };

function readFilters(): Filters {
  if (typeof window === 'undefined') return EMPTY;
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get('q') ?? '',
    chamber: (p.get('chamber') as Filters['chamber']) ?? '',
    status: p.get('status') ?? '',
    policy: p.get('policy') ?? '',
    party: (p.get('party') as Filters['party']) ?? '',
    sponsor: /^[A-Z]\d{6}$/.test(p.get('sponsor') ?? '') ? p.get('sponsor')! : '',
    sort: p.get('sort') === 'introduced' ? 'introduced' : 'latest',
    page: Math.max(1, Number(p.get('page') ?? 1) || 1),
  };
}

function writeFilters(f: Filters) {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.chamber) p.set('chamber', f.chamber);
  if (f.status) p.set('status', f.status);
  if (f.policy) p.set('policy', f.policy);
  if (f.party) p.set('party', f.party);
  if (f.sponsor) p.set('sponsor', f.sponsor);
  if (f.sort !== 'latest') p.set('sort', f.sort);
  if (f.page > 1) p.set('page', String(f.page));
  const qs = p.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

const isDefault = (f: Filters) =>
  !f.q && !f.chamber && !f.status && !f.policy && !f.party && !f.sponsor && f.sort === 'latest' && f.page === 1;

/** Build PostgREST filters shared by the table query and the search RPC. */
function restFilters(f: Filters, congress: number): Params {
  const params: Params = { congress: `eq.${congress}` };
  let select = BILL_LIST_COLUMNS;
  if (f.chamber === 'house') params.bill_type = 'in.(hr,hjres,hconres,hres)';
  if (f.chamber === 'senate') params.bill_type = 'in.(s,sjres,sconres,sres)';
  if (f.status) params.status = `eq.${f.status}`;
  if (f.policy) params.policy_area = `eq.${f.policy}`;
  if (f.sponsor) params.sponsor_id = `eq.${f.sponsor}`;
  if (f.party) {
    select += ',sponsor:members!inner(party)';
    params['sponsor.party'] = `eq.${f.party}`;
  }
  params.select = select;
  return params;
}

export default function BillExplorer({ congress, initial, policyAreas }: Props) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [bills, setBills] = useState<Bill[]>(initial);
  const [total, setTotal] = useState<number | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const request = useRef(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setFilters(readFilters());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeFilters(filters);
    if (isDefault(filters)) {
      setBills(initial);
      setTotal(null);
      setState('idle');
      return;
    }
    const id = ++request.current;
    setState('loading');
    (async () => {
      try {
        const params = restFilters(filters, congress);
        let rows: Bill[];
        let count: number;
        if (filters.q.trim()) {
          // Ranked full-text search; filters apply to the top 200 matches.
          rows = await rpc<Bill[]>('search_bills', { q: filters.q.trim(), max_results: 200 }, params);
          count = rows.length;
          rows = rows.slice((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE);
        } else {
          const order =
            filters.sort === 'introduced'
              ? 'introduced_date.desc.nullslast,number.desc'
              : 'latest_action_date.desc.nullslast,id.asc';
          const result = await selectWithCount<Bill>('bills', {
            ...params,
            order,
            limit: PAGE_SIZE,
            offset: (filters.page - 1) * PAGE_SIZE,
          });
          rows = result.rows;
          count = result.count;
        }
        if (id !== request.current) return;
        setBills(rows);
        setTotal(count);
        setState('idle');
      } catch (e) {
        if (id !== request.current) return;
        setError(
          e instanceof RestError && e.status === 400 ? 'That search could not be understood.' : 'Could not load bills.',
        );
        setState('error');
      }
    })();
  }, [filters, hydrated]);

  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));
  const lastPage = total === null ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <form
        class="toolbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget as HTMLFormElement).get('q');
          update({ q: String(q ?? '') });
        }}
      >
        <div class="field" style={{ flexBasis: '18rem' }}>
          <label for="bills-q">Search</label>
          <input id="bills-q" name="q" type="search" value={filters.q} placeholder="Words in the title or summary" />
        </div>
        <div class="field">
          <label for="bills-chamber">Chamber</label>
          <select
            id="bills-chamber"
            value={filters.chamber}
            onChange={(e) => update({ chamber: e.currentTarget.value as Filters['chamber'] })}
          >
            <option value="">Both</option>
            <option value="house">House</option>
            <option value="senate">Senate</option>
          </select>
        </div>
        <div class="field">
          <label for="bills-status">Status</label>
          <select id="bills-status" value={filters.status} onChange={(e) => update({ status: e.currentTarget.value })}>
            <option value="">Any</option>
            {BILL_STATUSES.map((s) => (
              <option value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="bills-policy">Policy area</label>
          <select id="bills-policy" value={filters.policy} onChange={(e) => update({ policy: e.currentTarget.value })}>
            <option value="">Any</option>
            {policyAreas.map((p) => (
              <option value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="bills-party">Sponsor’s party</label>
          <select
            id="bills-party"
            value={filters.party}
            onChange={(e) => update({ party: e.currentTarget.value as Filters['party'] })}
          >
            <option value="">Any</option>
            <option value="D">Democrat</option>
            <option value="R">Republican</option>
            <option value="I">Independent</option>
          </select>
        </div>
        {!filters.q && (
          <div class="field">
            <label for="bills-sort">Sort by</label>
            <select
              id="bills-sort"
              value={filters.sort}
              onChange={(e) => update({ sort: e.currentTarget.value as Filters['sort'] })}
            >
              <option value="latest">Latest action</option>
              <option value="introduced">Newest introduced</option>
            </select>
          </div>
        )}
        <button type="submit" class="primary">
          Search
        </button>
      </form>

      {filters.sponsor && (
        <p class="notice">
          Showing bills sponsored by <a href={memberHref(filters.sponsor)}>{filters.sponsor}</a>.{' '}
          <button type="button" class="link-button" onClick={() => update({ sponsor: '' })}>
            Clear
          </button>
        </p>
      )}
      <h2 class="visually-hidden">Results</h2>
      <p class="small muted" aria-live="polite">
        {state === 'loading'
          ? 'Loading…'
          : state === 'error'
            ? error
            : total === null
              ? 'Most recently active bills'
              : `${total.toLocaleString()} ${total === 1 ? 'bill' : 'bills'}${filters.q ? ' matching' : ''}`}
      </p>

      {bills.length === 0 && state === 'idle' ? (
        <p>No bills match those filters.</p>
      ) : (
        <ul class="list" aria-busy={state === 'loading'}>
          {bills.map((b) => (
            <BillListItem bill={b} />
          ))}
        </ul>
      )}

      {total !== null && lastPage > 1 && (
        <nav class="pager" aria-label="Pages">
          <button
            type="button"
            disabled={filters.page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
          >
            Previous
          </button>
          <span>
            Page {filters.page} of {lastPage}
          </span>
          <button
            type="button"
            disabled={filters.page >= lastPage}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
