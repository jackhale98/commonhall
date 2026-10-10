import { useEffect, useState } from 'preact/hooks';
import { getSession, hasRequestedDiscussion, hasStoredSession, setDiscussionRequest } from '../lib/auth';
import { hasSupabase } from '../lib/config';
import { discussionHref } from '../lib/paths';
import { rpc } from '../lib/rest';
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
    // One call: any discussion opened since the build, the count, and (signed out) whether this browser asked.
    const signedIn = hasStoredSession();
    rpc<{ count: number; mine: boolean | null; discussion: { id: string; title: string; status: string } | null }>(
      'discussion_request_state',
      { p_target_type: targetType, p_target_id: targetId, p_client_id: signedIn ? null : browserId() },
    )
      .then((state) => {
        setLive(state.discussion);
        setCount(state.count);
        if (!signedIn) setMine(Boolean(state.mine));
      })
      .catch(() => undefined);
    if (signedIn)
      getSession()
        .then((s) => (s ? hasRequestedDiscussion(targetType, targetId) : false))
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
      <button type="button" aria-pressed={mine ?? undefined} disabled={busy} onClick={toggle}>
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
