import { useEffect, useState } from 'preact/hooks';
import { accountUrl, getSession, hasRequestedDiscussion, hasStoredSession, setDiscussionRequest } from '../lib/auth';
import { hasSupabase } from '../lib/config';
import { rpc } from '../lib/rest';
import type { DiscussionTargetType } from '../lib/types';

interface Props {
  targetType: DiscussionTargetType;
  targetId: string;
}

/** "Ask for a discussion" on a bill or council matter, with a public count (never who asked). */
export default function DiscussionRequest({ targetType, targetId }: Props) {
  const [count, setCount] = useState<number | null>(null);
  const [mine, setMine] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hasSupabase) return;
    rpc<number>('discussion_request_count', { p_target_type: targetType, p_target_id: targetId })
      .then(setCount)
      .catch(() => undefined);
    if (!hasStoredSession()) return setMine(false);
    getSession()
      .then((s) => (s ? hasRequestedDiscussion(targetType, targetId) : false))
      .then(setMine)
      .catch(() => setMine(false));
  }, [targetType, targetId]);

  if (!hasSupabase) return null;

  const toggle = async () => {
    if (!hasStoredSession() || !(await getSession())) {
      window.location.href = accountUrl(window.location.pathname);
      return;
    }
    setBusy(true);
    try {
      await setDiscussionRequest(targetType, targetId, !mine);
      setCount((c) => (c ?? 0) + (mine ? -1 : 1));
      setMine(!mine);
    } finally {
      setBusy(false);
    }
  };

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
    </div>
  );
}
