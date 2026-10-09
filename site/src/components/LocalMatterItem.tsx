import { formatDate } from '../lib/format';
import { localMatterHref } from '../lib/paths';
import type { LocalMatter } from '../lib/types';

/** `href` overrides the clean URL (e.g. the fallback route for matters without a prerendered page). */
export default function LocalMatterItem({ matter, href }: { matter: LocalMatter; href?: string }) {
  return (
    <li class="bill-item">
      <p class="meta">
        {matter.file_number && <strong>Docket #{matter.file_number}</strong>}
        {matter.type && <> · {matter.type}</>}
        {matter.status && (
          <>
            {' '}
            · <span class="status-chip">{matter.status}</span>
          </>
        )}
      </p>
      <h3 class="bill-title matter-title">
        <a href={href ?? localMatterHref(matter.id)}>{matter.title}</a>
      </h3>
      {matter.latest_action_text && (
        <p class="meta">
          {formatDate(matter.latest_action_date)}: {matter.latest_action_text}
        </p>
      )}
    </li>
  );
}
