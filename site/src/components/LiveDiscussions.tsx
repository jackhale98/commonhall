import { useEffect, useState } from 'preact/hooks';
import { DISCUSSION_COLUMNS } from '../lib/discussions';
import { hasSupabase } from '../lib/config';
import { select } from '../lib/rest';
import type { Discussion } from '../lib/types';
import DiscussionCardView from './DiscussionCardView';

type Jurisdiction = Discussion['jurisdiction'];

interface Props {
  /** The list as of the last site build; shown at once, then refreshed from the database. */
  initial: Discussion[];
  /** Limit to these jurisdictions (default: all). */
  jurisdictions?: Jurisdiction[];
  /** Group open discussions under Boston / Massachusetts / National headings, and list closed ones. */
  grouped?: boolean;
  empty: string;
}

const LEVELS: { key: Jurisdiction; title: string }[] = [
  { key: 'boston', title: 'Boston' },
  { key: 'worcester', title: 'Worcester' },
  { key: 'ma', title: 'Massachusetts' },
  { key: 'federal', title: 'National' },
];

/**
 * Discussions list that stays current between site builds: a discussion opened in
 * the admin page appears here right away instead of after the nightly rebuild.
 */
export default function LiveDiscussions({ initial, jurisdictions, grouped = false, empty }: Props) {
  const [all, setAll] = useState(initial);
  useEffect(() => {
    if (!hasSupabase) return;
    select<Discussion>('discussions', { select: DISCUSSION_COLUMNS, status: 'neq.draft', order: 'created_at.desc' })
      .then(setAll)
      .catch(() => undefined);
  }, []);
  const mine = all.filter((d) => !jurisdictions || jurisdictions.includes(d.jurisdiction));
  const open = mine.filter((d) => d.status === 'open');
  if (!grouped) {
    return open.length > 0 ? (
      <ul class="list card-grid">
        {open.map((d) => (
          <DiscussionCardView discussion={d} />
        ))}
      </ul>
    ) : (
      <p class="muted">{empty}</p>
    );
  }
  const closed = mine.filter((d) => d.status === 'closed');
  return (
    <>
      <section aria-labelledby="open-h">
        <h2 id="open-h">Open</h2>
        {open.length === 0 && <p class="muted">{empty}</p>}
        {LEVELS.map((l) => ({ ...l, list: open.filter((d) => d.jurisdiction === l.key) }))
          .filter((l) => l.list.length > 0)
          .map((l) => (
            <section aria-labelledby={`open-${l.key}-h`} class="discussion-level">
              <h3 id={`open-${l.key}-h`}>{l.title}</h3>
              <ul class="list card-grid">
                {l.list.map((d) => (
                  <DiscussionCardView discussion={d} />
                ))}
              </ul>
            </section>
          ))}
      </section>
      {closed.length > 0 && (
        <section aria-labelledby="closed-h">
          <h2 id="closed-h">Closed</h2>
          <ul class="list card-grid">
            {closed.map((d) => (
              <DiscussionCardView discussion={d} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
