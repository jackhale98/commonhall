import { jurisdictionLabel } from '../lib/discussions';
import { formatDate } from '../lib/format';
import { discussionHref } from '../lib/paths';
import type { Discussion } from '../lib/types';

/** One discussion in a list. Shared by build-time pages and the live list. */
export default function DiscussionCardView({ discussion: d }: { discussion: Discussion }) {
  const excerpt = d.prompt.length > 220 ? `${d.prompt.slice(0, 217)}…` : d.prompt;
  return (
    <li class="bill-item discussion-card">
      <p class="meta">
        <span class={`status-chip ${d.status === 'open' ? 'status-open' : ''}`}>
          {d.status === 'open' ? 'Open' : 'Closed'}
        </span>{' '}
        · {jurisdictionLabel(d)}
        {d.closes_at && d.status === 'open' && <> · closes {formatDate(d.closes_at)}</>}
      </p>
      <h3 class="bill-title">
        <a href={discussionHref(d.id)}>{d.title}</a>
      </h3>
      <p class="small">{excerpt}</p>
      <p class="join">{d.status === 'open' ? 'Add your voice →' : 'See the results →'}</p>
    </li>
  );
}
