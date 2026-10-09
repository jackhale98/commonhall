import { useEffect, useState } from 'preact/hooks';
import { getSession, hasRequestedDiscussion, hasStoredSession, setDiscussionRequest } from '../lib/auth';
import { hasSupabase } from '../lib/config';
import { discussionHref } from '../lib/paths';
import { rpc, select } from '../lib/rest';
import type { DiscussionTargetType } from '../lib/types';

interface Props {
  targetType: DiscussionTargetType;
  targetId: string;
}

const CLIENT_KEY = 'civic.request-client';

/** A random id for this browser, so a signed-out visitor counts once per item. Not linked to anything else. */
function browserId(): string | null {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * "Ask for a discussion" on an item, with a public count (never who asked).
 * Signed-in users' requests are tied to their account; signed-out visitors'
 * to a random per-browser id.
 */
export default function DiscussionRequest({ targetType, targetId }: Props) {
  const [count, setCount] = useState<number | null>(null);
  const [mine, setMine] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A discussion opened since the last site build.
  const [live, setLive] = useState<{ id: string; title: string; status: string } | null>(null);

  useEffect(() => {
    if (!hasSupabase) return;
    select<{ id: string; title: string; status: string }>('discussions', {
      select: 'id,title,status',
      target_type: `eq.${targetType}`,
      target_id: `eq.${targetId}`,
      status: 'neq.draft',
      limit: 1,
    })
      .then((rows) => setLive(rows[0] ?? null))
      .catch(() => undefined);
    rpc<number>('discussion_request_count', { p_target_type: targetType, p_target_id: targetId })
      .then(setCount)
      .catch(() => undefined);
    const anonymous = async () => {
      const id = browserId();
      return id
        ? rpc<boolean>('has_anonymous_discussion_request', {
            p_client_id: id,
            p_target_type: targetType,
            p_target_id: targetId,
          })
        : false;
    };
    (hasStoredSession() ? getSession() : Promise.resolve(null))
      .then((s) => (s ? hasRequestedDiscussion(targetType, targetId) : anonymous()))
      .then(setMine)
      .catch(() => setMine(false));
  }, [targetType, targetId]);

  if (!hasSupabase) return null;

  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      const session = hasStoredSession() ? await getSession() : null;
      if (session) await setDiscussionRequest(targetType, targetId, !mine);
      else {
        const id = browserId();
        if (!id) throw new Error('This browser blocks storage, so requests need sign-in.');
        await rpc('set_anonymous_discussion_request', {
          p_client_id: id,
          p_target_type: targetType,
          p_target_id: targetId,
          p_on: !mine,
        });
      }
      setCount((c) => (c ?? 0) + (mine ? -1 : 1));
      setMine(!mine);
    } catch (e) {
      setError(
        e instanceof Error && /Too many|storage/.test(e.message) ? e.message : 'Couldn’t save that; please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (live) {
    return (
      <p class="notice discussion-callout">
        <strong>{live.status === 'open' ? 'Discussion open:' : 'Discussion (closed):'}</strong>{' '}
        <a href={discussionHref(live.id)}>{live.title}</a>
      </p>
    );
  }

  return (
    <div class="discussion-request cluster small">
      <button type="button" class="link-button" aria-pressed={mine ?? undefined} disabled={busy} onClick={toggle}>
        {mine ? '✓ You asked for a discussion' : 'Ask for a public discussion of this'}
      </button>
      {count !== null && count > 0 && (
        <span class="muted">
          {count} {count === 1 ? 'person has' : 'people have'} asked
        </span>
      )}
      {error && (
        <span class="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
