import { useEffect, useState } from 'preact/hooks';
import { accountUrl, getClient, getSession, isAdmin } from '../lib/auth';
import { CITIES, CITY_LIST, cityOf } from '../lib/cities';
import { hasSupabase } from '../lib/config';
import { DISCUSSION_COLUMNS, targetHref } from '../lib/discussions';
import { formatDate } from '../lib/format';
import { discussionHref } from '../lib/paths';
import type { Discussion, DiscussionTargetType } from '../lib/types';

interface RequestRow {
  target_type: DiscussionTargetType;
  target_id: string;
  requests: number;
  latest: string;
}

type Draft = Omit<Discussion, 'created_at'>;

const TYPE_LABEL: Record<DiscussionTargetType, string> = {
  bill: 'Bill',
  state_bill: 'MA bill',
  local_matter: 'Boston matter',
  executive_order: 'Executive order',
  scotus_case: 'Supreme Court decision',
  capital_project: 'Capital project',
  state_order: 'Governor’s order',
  state_court_case: 'State court decision',
};

/** Discussions grouped by status; closed ones are folded away. */
const GROUPS: { status: Discussion['status']; title: string; collapsed: boolean }[] = [
  { status: 'draft', title: 'Drafts', collapsed: false },
  { status: 'open', title: 'Open', collapsed: false },
  { status: 'closed', title: 'Closed', collapsed: true },
];

const EMPTY: Draft = {
  id: '',
  title: '',
  prompt: '',
  jurisdiction: CITY_LIST[0]!.key,
  district: null,
  target_type: null,
  target_id: null,
  status: 'draft',
  residency_required: true,
  opens_at: null,
  closes_at: null,
};

/** Maintainers create, open and close discussions here. RLS enforces who may write. */
export default function AdminDiscussions() {
  const [state, setState] = useState<'loading' | 'signed-out' | 'denied' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<Discussion[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    const client = await getClient();
    const [list, summary] = await Promise.all([
      client.from('discussions').select(DISCUSSION_COLUMNS).order('created_at', { ascending: false }),
      client.rpc('discussion_request_summary'),
    ]);
    if (list.error) throw list.error;
    setRows((list.data ?? []) as Discussion[]);
    setRequests((summary.data ?? []) as RequestRow[]);
  };

  useEffect(() => {
    if (!hasSupabase) return setState('denied');
    (async () => {
      if (!(await getSession())) return setState('signed-out');
      if (!(await isAdmin())) return setState('denied');
      await refresh();
      setState('ready');
    })().catch(() => setState('error'));
  }, []);

  if (state === 'loading') return <p>Loading…</p>;
  if (state === 'signed-out') {
    return (
      <p class="notice">
        <a href={accountUrl(window.location.pathname)}>Sign in</a> with a maintainer account.
      </p>
    );
  }
  if (state === 'denied') return <p class="notice">This page is for maintainers. Ask the site owner for access.</p>;
  if (state === 'error') return <p class="notice error">Couldn’t load discussions.</p>;

  // A request is covered once any discussion (draft, open or closed) exists for its item.
  const byTarget = new Map(rows.filter((d) => d.target_type).map((d) => [`${d.target_type}:${d.target_id}`, d]));
  const waiting = requests.filter((r) => !byTarget.has(`${r.target_type}:${r.target_id}`));
  const covered = requests
    .map((r) => ({ r, d: byTarget.get(`${r.target_type}:${r.target_id}`) }))
    .filter((x): x is { r: RequestRow; d: Discussion } => Boolean(x.d));
  const requestCount = (d: Discussion) =>
    requests.find((r) => r.target_type === d.target_type && r.target_id === d.target_id)?.requests ?? 0;
  const edit = (d: Discussion) => {
    setEditing(d.id);
    setDraft({ ...d });
    window.scrollTo({ top: 0 });
  };
  const startFrom = (r: RequestRow) => {
    setEditing(null);
    setDraft({
      ...EMPTY,
      target_type: r.target_type,
      target_id: r.target_id,
      jurisdiction:
        r.target_type === 'state_bill'
          ? 'ma'
          : r.target_type === 'state_order' || r.target_type === 'state_court_case'
            ? r.target_id.split('-')[0]!
            : r.target_type === 'local_matter' || r.target_type === 'capital_project'
              ? (cityOf(r.target_id)?.key ?? 'federal')
              : 'federal',
    });
    window.scrollTo({ top: 0 });
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const save = async (e: Event) => {
    e.preventDefault();
    setMessage('');
    const client = await getClient();
    const row = {
      ...draft,
      district: CITIES[draft.jurisdiction] ? draft.district : null,
      target_id: draft.target_type ? draft.target_id?.trim() || null : null,
      opens_at: draft.opens_at || null,
      closes_at: draft.closes_at || null,
    };
    const { error } = editing
      ? await client.from('discussions').update(row).eq('id', editing)
      : await client.from('discussions').insert(row);
    if (error) return setMessage(error.message);
    setMessage(
      `Saved. ${row.status === 'draft' ? 'Drafts are visible only to maintainers.' : 'It is live now and gets its own prerendered page at the next build.'}`,
    );
    setDraft(EMPTY);
    setEditing(null);
    await refresh();
  };

  return (
    <div class="stack">
      <section>
        <h2>
          Waiting for a discussion <span class="muted">({waiting.length})</span>
        </h2>
        <p class="small muted">Requested items with no discussion yet, most requested first.</p>
        {waiting.length === 0 && <p class="muted">Nothing waiting.</p>}
        <ul class="list">
          {waiting.map((r) => (
            <li class="cluster admin-row">
              <span>
                <strong>{r.requests}</strong> {r.requests === 1 ? 'request' : 'requests'} ·{' '}
                <a href={targetHref(r.target_type, r.target_id) ?? '#'}>
                  {TYPE_LABEL[r.target_type]} {r.target_id}
                </a>{' '}
                <span class="small muted">latest {formatDate(r.latest)}</span>
              </span>
              <button type="button" class="link-button" onClick={() => startFrom(r)}>
                Start a discussion
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{editing ? `Edit “${editing}”` : 'New discussion'}</h2>
        <p class="small muted">
          Before opening a discussion, create the matching conversation in the Pol.is admin with the same page id, and
          add the seed statements. Only discussions on the pilot list may be opened without asking the owner.
        </p>
        <form class="stack admin-form" onSubmit={save}>
          <div class="field">
            <label for="d-id">Id (lowercase, hyphens; becomes the URL and the Pol.is page id)</label>
            <input
              id="d-id"
              required
              pattern="[a-z0-9][a-z0-9-]{2,59}"
              value={draft.id}
              disabled={Boolean(editing)}
              onInput={(e) => set('id', e.currentTarget.value)}
            />
          </div>
          <div class="field">
            <label for="d-title">Title (a neutral question)</label>
            <input
              id="d-title"
              required
              maxLength={200}
              value={draft.title}
              onInput={(e) => set('title', e.currentTarget.value)}
            />
          </div>
          <div class="field">
            <label for="d-prompt">Prompt (background and the question, neutral wording)</label>
            <textarea
              id="d-prompt"
              required
              rows={5}
              maxLength={2000}
              value={draft.prompt}
              onInput={(e) => set('prompt', e.currentTarget.value)}
            />
          </div>
          <div class="cluster">
            <div class="field">
              <label for="d-jur">Jurisdiction</label>
              <select
                id="d-jur"
                value={draft.jurisdiction}
                onChange={(e) => set('jurisdiction', e.currentTarget.value as Draft['jurisdiction'])}
              >
                <option value="federal">United States</option>
                <option value="ma">Massachusetts</option>
                {CITY_LIST.map((c) => (
                  <option value={c.key}>{c.name}</option>
                ))}
              </select>
            </div>
            {CITIES[draft.jurisdiction] && (
              <div class="field">
                <label for="d-district">Council district (blank = citywide)</label>
                <input
                  id="d-district"
                  type="number"
                  min={1}
                  max={CITIES[draft.jurisdiction]!.districts}
                  value={draft.district ?? ''}
                  onInput={(e) => set('district', e.currentTarget.value ? Number(e.currentTarget.value) : null)}
                />
              </div>
            )}
            <div class="field">
              <label for="d-status">Status</label>
              <select
                id="d-status"
                value={draft.status}
                onChange={(e) => set('status', e.currentTarget.value as Draft['status'])}
              >
                <option value="draft">Draft</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
          <div class="cluster">
            <div class="field">
              <label for="d-ttype">About</label>
              <select
                id="d-ttype"
                value={draft.target_type ?? ''}
                onChange={(e) => set('target_type', (e.currentTarget.value || null) as Draft['target_type'])}
              >
                <option value="">Nothing specific</option>
                <option value="bill">Federal bill</option>
                <option value="state_bill">State bill</option>
                <option value="local_matter">Boston council matter</option>
                <option value="executive_order">Executive order</option>
                <option value="scotus_case">Supreme Court decision</option>
                <option value="capital_project">Capital project (Boston id, or worcester-…)</option>
                <option value="state_order">Governor’s executive order (ma-635)</option>
                <option value="state_court_case">State high court decision (ma- and its CourtListener id)</option>
              </select>
            </div>
            {draft.target_type && (
              <div class="field">
                <label for="d-tid">
                  Item id (e.g. 119-hr-1, boston-43547; an order's document number, 2026-20321; a decision's id from its
                  page address; a capital project's id, CCC25057)
                </label>
                <input
                  id="d-tid"
                  required
                  value={draft.target_id ?? ''}
                  onInput={(e) => set('target_id', e.currentTarget.value)}
                />
              </div>
            )}
          </div>
          <div class="cluster">
            <div class="field">
              <label for="d-opens">Opens (optional)</label>
              <input
                id="d-opens"
                type="date"
                value={draft.opens_at?.slice(0, 10) ?? ''}
                onInput={(e) => set('opens_at', e.currentTarget.value || null)}
              />
            </div>
            <div class="field">
              <label for="d-closes">Closes (optional)</label>
              <input
                id="d-closes"
                type="date"
                value={draft.closes_at?.slice(0, 10) ?? ''}
                onInput={(e) => set('closes_at', e.currentTarget.value || null)}
              />
            </div>
          </div>
          <label class="check">
            <input
              type="checkbox"
              checked={draft.residency_required}
              onChange={(e) => set('residency_required', e.currentTarget.checked)}
            />{' '}
            Only residents may vote and write (honor system, from the saved address)
          </label>
          <div class="cluster">
            <button type="submit" class="primary">
              {editing ? 'Save changes' : 'Create'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setDraft(EMPTY);
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {message && <p role="status">{message}</p>}
        </form>
      </section>

      {GROUPS.map(({ status, title, collapsed }) => {
        const list = rows.filter((d) => d.status === status);
        if (list.length === 0) return null;
        const items = (
          <ul class="list">
            {list.map((d) => (
              <li class="cluster admin-row">
                <span>
                  <a href={discussionHref(d.id)}>{d.title}</a>{' '}
                  <span class="small muted">
                    ({d.id}
                    {d.target_type && `, about ${TYPE_LABEL[d.target_type]} ${d.target_id}`}
                    {requestCount(d) > 0 && `, ${requestCount(d)} requested`}, created {formatDate(d.created_at)})
                  </span>
                </span>
                <button type="button" class="link-button" onClick={() => edit(d)}>
                  Edit
                </button>
              </li>
            ))}
          </ul>
        );
        return (
          <section>
            {collapsed ? (
              <details>
                <summary>
                  <h2 class="inline-h">
                    {title} <span class="muted">({list.length})</span>
                  </h2>
                </summary>
                {items}
              </details>
            ) : (
              <>
                <h2>
                  {title} <span class="muted">({list.length})</span>
                </h2>
                {items}
              </>
            )}
          </section>
        );
      })}

      {covered.length > 0 && (
        <section>
          <details>
            <summary>
              <h2 class="inline-h">
                Requests already covered <span class="muted">({covered.length})</span>
              </h2>
            </summary>
            <ul class="list">
              {covered.map(({ r, d }) => (
                <li class="cluster admin-row">
                  <span>
                    <strong>{r.requests}</strong> ·{' '}
                    <a href={targetHref(r.target_type, r.target_id) ?? '#'}>
                      {TYPE_LABEL[r.target_type]} {r.target_id}
                    </a>{' '}
                    <span class="small muted">
                      → <a href={discussionHref(d.id)}>{d.title}</a> ({d.status})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}
