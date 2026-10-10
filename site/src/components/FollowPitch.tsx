import { accountUrl } from '../lib/auth';
import { href } from '../lib/paths';

/**
 * What a signed-out visitor sees on the feed and following pages: what following
 * does, how to start, and where to find things to follow, instead of a bare
 * "Sign in" line.
 */
export default function FollowPitch({ returnTo }: { returnTo: string }) {
  return (
    <div class="follow-pitch card">
      <h2 class="h-small">Follow what matters to you</h2>
      <p>
        Follow bills, members of Congress, state legislators, city councilors and council items. Your feed then shows
        each new action, vote and hearing on them, newest first. It’s free, and we only store your email address and
        what you follow.
      </p>
      <p>
        <a class="button primary" href={accountUrl(returnTo)}>
          Sign in or create an account
        </a>
      </p>
      <h3 class="h-small">Good places to start</h3>
      <ul class="follow-starts">
        <li>
          <a href={href('reps/')}>Your representatives</a>: find them by address and follow them all at once
        </li>
        <li>
          <a href={href('bills/')}>Bills in Congress</a>: search by topic and follow the ones you care about
        </li>
        <li>
          <a href={href('states/')}>Your state</a>: its legislators and bills
        </li>
        <li>
          <a href={href('discussions/')}>Discussions</a>: say where you stand and see where people agree
        </li>
      </ul>
    </div>
  );
}
