import { useEffect, useState } from 'preact/hooks';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseBillId } from '@civic/congress-client/ids';
import { accountUrl, getClient, hasStoredSession } from '../lib/auth';
import { formatDate } from '../lib/format';
import {
  billHref,
  discussionHref,
  executiveOrderHref,
  href,
  localMatterHref,
  localOfficialHref,
  memberHref,
  capitalProjectHref,
  scotusCaseHref,
  stateBillFallbackHref,
  stateLegislatorHref,
  voteHref,
} from '../lib/paths';
import type { Member } from '../lib/types';
import { LEVELS, legislatorFilter, type Level } from '../lib/feed-filters';
import Loader from './Loader';

export interface FeedItem {
  id: number;
  target_type:
    | 'bill'
    | 'member'
    | 'state_bill'
    | 'state_legislator'
    | 'local_matter'
    | 'local_official'
    | 'discussion'
    | 'executive_order'
    | 'scotus_case'
    | 'capital_project';
  target_id: string;
  kind: 'action' | 'vote' | 'cosponsor' | 'new_bill' | 'new_item' | 'discussion_opened';
  member_type: string | null;
  member_id: string | null;
  occurred_at: string;
  summary: string;
  payload: Record<string, unknown>;
  reason: 'target' | 'legislator';
  unread: boolean;
}

const KIND_LABELS: Record<FeedItem['kind'], string> = {
  action: 'Action',
  vote: 'Vote',
  cosponsor: 'Cosponsor',
  new_bill: 'New bill',
  new_item: 'New item',
  discussion_opened: 'Discussion',
};

const PAGE = 30;

export function targetLink(item: Pick<FeedItem, 'target_type' | 'target_id' | 'payload'>): string | null {
  if (typeof item.payload.discussion_id === 'string') return discussionHref(item.payload.discussion_id);
  if (item.target_type === 'bill') {
    const ref = parseBillId(item.target_id);
    return ref ? billHref(ref.congress, ref.type, ref.number) : null;
  }
  if (item.target_type === 'member') return memberHref(item.target_id);
  if (item.target_type === 'state_bill') return stateBillFallbackHref(item.target_id);
  if (item.target_type === 'state_legislator') return stateLegislatorHref(item.target_id);
  if (item.target_type === 'local_matter') return localMatterHref(item.target_id);
  if (item.target_type === 'local_official') return localOfficialHref(item.target_id);
  if (item.target_type === 'discussion') return discussionHref(item.target_id);
  if (item.target_type === 'executive_order') return executiveOrderHref(item.target_id);
  if (item.target_type === 'scotus_case') return scotusCaseHref(item.target_id);
  if (item.target_type === 'capital_project') return capitalProjectHref(item.target_id);
  return null;
}

interface Props {
  /** Compact list for the home page. */
  compact?: boolean;
}

export default function FeedView({ compact = false }: Props) {
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [members, setMembers] = useState<Map<string, Pick<Member, 'bioguide_id' | 'name'>>>(new Map());
  const [filter, setFilter] = useState<'' | 'bill' | 'member' | 'state' | 'boston'>('');
  // Within Legislators: members of Congress, state legislators or Boston councilors.
  const [level, setLevel] = useState<Level>('');
  const [more, setMore] = useState(false);
  const [follows, setFollows] = useState<number | null>(null);

  async function load(client: SupabaseClient, offset: number) {
    let query = client
      .from('feed')
      .select('*')
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + (compact ? 5 : PAGE) - 1);
    if (filter === 'bill') query = query.eq('target_type', 'bill');
    if (filter === 'member') query = query.or(legislatorFilter(level));
    // Legislators at each level are under Legislators; these are the bills and matters.
    if (filter === 'state') query = query.eq('target_type', 'state_bill');
    if (filter === 'boston') query = query.eq('target_type', 'local_matter');
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as FeedItem[];
    const ids = [
      ...new Set(
        rows
          .flatMap((r) => [
            r.member_type === 'member' ? r.member_id : null,
            r.target_type === 'member' ? r.target_id : null,
          ])
          .filter(Boolean),
      ),
    ] as string[];
    if (ids.length > 0) {
      const { data: people } = await client.from('members').select('bioguide_id,name').in('bioguide_id', ids);
      setMembers((prev) => new Map([...prev, ...(people ?? []).map((p) => [p.bioguide_id, p] as const)]));
    }
    return rows;
  }

  useEffect(() => {
    if (!hasStoredSession()) {
      setState('signed-out');
      return;
    }
    let cancelled = false;
    (async () => {
      const client = await getClient();
      const { data } = await client.auth.getSession();
      if (!data.session) return setState('signed-out');
      const rows = await load(client, 0);
      if (cancelled) return;
      setItems(rows);
      setMore(!compact && rows.length === PAGE);
      setState('ready');
      if (rows.length === 0) {
        const { count } = await client.from('follows').select('target_id', { count: 'exact', head: true });
        setFollows(count ?? 0);
      }
      if (!compact) {
        // Viewing the full feed marks everything read (the unread markers stay until reload).
        await client
          .from('feed_reads')
          .upsert({ user_id: data.session.user.id, last_seen_at: new Date().toISOString() });
      }
    })().catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, [filter, level]);

  async function loadMore() {
    const client = await getClient();
    const rows = await load(client, items.length);
    setItems((prev) => [...prev, ...rows]);
    setMore(rows.length === PAGE);
  }

  if (state === 'loading') return compact ? null : <Loader label="Loading your feed" />;
  if (state === 'signed-out') {
    return compact ? null : (
      <p class="notice">
        <a href={accountUrl(href('feed/'))}>Sign in</a> to see updates on the bills and legislators you follow.
      </p>
    );
  }
  if (state === 'error') return <p class="notice error">Couldn’t load your feed. Please try again.</p>;

  const unread = items.filter((i) => i.unread).length;

  return (
    <section aria-labelledby="feed-h" class={compact ? 'home-feed' : undefined}>
      {compact ? (
        <h2 id="feed-h">Your feed {unread > 0 && <span class="badge">{unread} new</span>}</h2>
      ) : (
        <div class="type-chips feed-filters" role="group" aria-label="Show">
          {(
            [
              ['', 'Everything'],
              ['member', 'Legislators'],
              ['bill', 'Bills'],
              ['state', 'State bills'],
              ['boston', 'Boston matters'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              class="chip-button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setLevel('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!compact && filter === 'member' && (
        <div class="type-chips feed-levels" role="group" aria-label="Level of government">
          {LEVELS.map(([value, label]) => (
            <button type="button" class="chip-button" aria-pressed={level === value} onClick={() => setLevel(value)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p class="muted">
          {follows === 0 ? (
            <>
              You aren’t following anything yet. Use the Follow button on any <a href={href('bills/')}>bill</a> or{' '}
              <a href={href('members/')}>member</a>.
            </>
          ) : (
            'Nothing new yet. Updates appear here within the hour after Congress acts.'
          )}
        </p>
      ) : (
        <ol class="list feed-list">
          {items.map((item) => {
            const link = targetLink(item);
            const who = item.member_id ? members.get(item.member_id)?.name : undefined;
            const voteId = item.kind === 'vote' ? (item.payload.vote_id as string | undefined) : undefined;
            return (
              <li class={item.unread ? 'unread' : undefined}>
                <p class="meta">
                  {item.unread && <span class="badge">New</span>} {KIND_LABELS[item.kind]} ·{' '}
                  <time datetime={item.occurred_at}>{formatDate(item.occurred_at)}</time>
                  {item.reason === 'legislator' && who && <> · via {who}</>}
                </p>
                <p class="feed-summary">
                  {link ? <a href={link}>{item.summary}</a> : item.summary}
                  {item.kind === 'cosponsor' && who && <> ({who})</>}
                </p>
                {voteId && (
                  <p class="small">
                    <a href={voteHref(voteId)}>See the vote</a>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {compact && items.length > 0 && (
        <p>
          <a href={href('feed/')}>See your full feed</a>
        </p>
      )}
      {more && (
        <p>
          <button type="button" onClick={loadMore}>
            Load more
          </button>
        </p>
      )}
    </section>
  );
}
