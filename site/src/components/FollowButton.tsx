import { useEffect, useState } from 'preact/hooks';
import {
  accountUrl,
  follow,
  getSession,
  hasStoredSession,
  isFollowing,
  savePendingFollow,
  unfollow,
} from '../lib/auth';

interface Props {
  targetType: 'bill' | 'member' | 'state_bill' | 'state_legislator';
  targetId: string;
  /** Used in the accessible name, e.g. "H.R. 1". */
  label: string;
}

type State = 'unknown' | 'signed-out' | 'following' | 'not-following' | 'busy' | 'error';

/**
 * One button for every followable thing. Signed out, it remembers the intended
 * follow and sends the visitor to sign in; the account page completes it.
 */
export default function FollowButton({ targetType, targetId, label }: Props) {
  const [state, setState] = useState<State>('unknown');

  useEffect(() => {
    if (!hasStoredSession()) {
      setState('signed-out');
      return;
    }
    (async () => {
      try {
        const session = await getSession();
        if (!session) return setState('signed-out');
        setState((await isFollowing(targetType, targetId)) ? 'following' : 'not-following');
      } catch {
        setState('error');
      }
    })();
  }, [targetType, targetId]);

  const onClick = async () => {
    if (state === 'signed-out' || state === 'unknown') {
      const here = window.location.pathname + window.location.search;
      savePendingFollow(targetType, targetId, here);
      window.location.href = accountUrl(here);
      return;
    }
    const wasFollowing = state === 'following';
    setState('busy');
    try {
      if (wasFollowing) await unfollow(targetType, targetId);
      else await follow(targetType, targetId);
      setState(wasFollowing ? 'not-following' : 'following');
    } catch {
      setState('error');
    }
  };

  const following = state === 'following';
  return (
    <button
      type="button"
      class={following ? 'follow-button following' : 'follow-button primary'}
      aria-pressed={state === 'following' || state === 'not-following' ? following : undefined}
      aria-label={following ? `Unfollow ${label}` : `Follow ${label}`}
      disabled={state === 'busy'}
      onClick={onClick}
    >
      {state === 'busy' ? 'Saving…' : following ? '✓ Following' : state === 'error' ? 'Try again' : 'Follow'}
    </button>
  );
}
