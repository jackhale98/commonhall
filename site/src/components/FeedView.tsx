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
import { LEVELS, legislatorFilter, type Level } from '../lib/feed-filters';
import { voteSubject } from '../lib/vote-subject';
import Loader from './Loader';
import MemberPhoto from './MemberPhoto';

interface Person {
  name: string;
  photo_url: string | null;
  bioguideId?: string;
}

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

/** What the entry is about, for the card's kicker. */
const TARGET_LABELS: Partial<Record<FeedItem['target_type'], string>> = {
  bill: 'Bill',
  state_bill: 'State bill',
  local_matter: 'Council item',
  executive_order: 'Executive order',
  scotus_case: 'Supreme Court',
  capital_project: 'Capital project',
  discussion: 'Discussion',
};

const POSITION: Record<string, string> = {
  yea: 'Voted yes',
  nay: 'Voted no',
  present: 'Voted present',
  not_voting: 'Did not vote',
};

/** A vote's question without the "Name voted no:" lead the summary carries. */
const question = (item: FeedItem) =>
  typeof item.payload.question === 'string' && item.payload.question
    ? item.payload.question
    : item.summary.replace(/^.*? voted [a-z ]+?: /, '');

export function targetLink(item: Pick<FeedItem, 'target_type' | 'target_id' | 'payload'>): string | null {
  if (typeof item.payload.discussion_id === 'string') return discussionHref(item.payload.discussion_id);
  // A vote opens the roll call, not the legislator or bill it came through.
  if (typeof item.payload.vote_id === 'string') return voteHref(item.payload.vote_id);
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
  // People named in the feed (members of Congress, state legislators, councilors), keyed by their id.
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [filter, setFilter] = useState<'' | 'bill' | 'member' | 'state' | 'local'>('');
  // Within Legislators: members of Congress, state legislators or city councilors.
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
    if (filter === 'local') query = query.eq('target_type', 'local_matter');
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as FeedItem[];
    // Names and photos for the people the entries mention: one small query per kind.
    const want = (type: string) => [
      ...new Set(
        rows
          .flatMap((r) => [r.member_type === type ? r.member_id : null, r.target_type === type ? r.target_id : null])
          .filter((id): id is string => !!id && !people.has(id)),
      ),
    ];
    const found: [string, Person][] = [];
    const congress = want('member');
    if (congress.length) {
      const { data: rowsM } = await client
        .from('members')
        .select('bioguide_id,name,photo_url')
        .in('bioguide_id', congress);
      for (const p of rowsM ?? [])
        found.push([p.bioguide_id, { name: p.name, photo_url: p.photo_url, bioguideId: p.bioguide_id }]);
    }
    const legislators = want('state_legislator');
    if (legislators.length) {
      const { data: rowsL } = await client.from('state_legislators').select('id,name,photo_url').in('id', legislators);
      for (const p of rowsL ?? []) found.push([p.id, { name: p.name, photo_url: p.photo_url }]);
    }
    const officials = want('local_official');
    if (officials.length) {
      const { data: rowsO } = await client.from('local_officials').select('id,name,photo_url').in('id', officials);
      for (const p of rowsO ?? []) found.push([p.id, { name: p.name, photo_url: p.photo_url }]);
    }
    if (found.length) setPeople((prev) => new Map([...prev, ...found]));
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
              ['local', 'Local matters'],
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
        <ol class="feed-cards">
          {items.map((item) => {
            const link = targetLink(item);
            const personId =
              item.member_id ??
              (['member', 'state_legislator', 'local_official'].includes(item.target_type) ? item.target_id : null);
            const person = personId ? people.get(personId) : undefined;
            const position = typeof item.payload.position === 'string' ? item.payload.position : null;
            const isVote = item.kind === 'vote' && position !== null;
            const chamber =
              item.payload.chamber === 'house' ? 'House' : item.payload.chamber === 'senate' ? 'Senate' : null;
            const result = typeof item.payload.result === 'string' ? item.payload.result : null;
            // What the vote was about (the bill, the nominee), so the question isn't all there is.
            const subject = isVote ? voteSubject(item.payload) : null;
            const voteBill =
              typeof item.payload.vote_id === 'string' &&
              typeof item.payload.bill_id === 'string' &&
              item.target_type !== 'bill'
                ? parseBillId(item.payload.bill_id)
                : null;
            return (
              <li class={`feed-card${item.unread ? ' unread' : ''}`}>
                <div class="feed-avatar">
                  {person ? (
                    <MemberPhoto name={person.name} url={person.photo_url} bioguideId={person.bioguideId} size={44} />
                  ) : (
                    <span class={`feed-kind-badge kind-${item.kind}`} aria-hidden="true">
                      {KIND_LABELS[item.kind].charAt(0)}
                    </span>
                  )}
                </div>
                <div class="feed-body">
                  <p class="feed-kicker">
                    <span class={`feed-kind kind-${item.kind}`}>{KIND_LABELS[item.kind]}</span>
                    {!isVote && item.kind !== 'discussion_opened' && TARGET_LABELS[item.target_type] && (
                      <span>{TARGET_LABELS[item.target_type]}</span>
                    )}
                    {chamber && <span>{chamber}</span>}
                    <time datetime={item.occurred_at}>{formatDate(item.occurred_at)}</time>
                    {item.unread && <span class="badge">New</span>}
                  </p>
                  {isVote ? (
                    <>
                      <p class="feed-who">
                        <strong>{person?.name ?? item.summary.split(' voted ')[0]}</strong>
                        <span class={`feed-position position-chip-${position}`}>{POSITION[position!] ?? position}</span>
                      </p>
                      <p class="feed-title">
                        {link ? (
                          <a class="stretched" href={link}>
                            {subject ?? question(item)}
                          </a>
                        ) : (
                          (subject ?? question(item))
                        )}
                      </p>
                      {(subject || result) && (
                        <p class="feed-meta">{[subject && question(item), result].filter(Boolean).join(' · ')}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p class="feed-title">
                        {link ? (
                          <a class="stretched" href={link}>
                            {item.summary}
                          </a>
                        ) : (
                          item.summary
                        )}
                      </p>
                      {(item.reason === 'legislator' || item.kind === 'cosponsor') && person && (
                        <p class="feed-meta">
                          {item.kind === 'cosponsor' ? `Cosponsor: ${person.name}` : `Via ${person.name}`}
                        </p>
                      )}
                    </>
                  )}
                  {voteBill && (
                    <p class="feed-sub">
                      <a href={billHref(voteBill.congress, voteBill.type, voteBill.number)}>See the bill →</a>
                    </p>
                  )}
                </div>
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
