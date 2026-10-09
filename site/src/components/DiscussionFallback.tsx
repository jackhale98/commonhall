import { useEffect, useState } from 'preact/hooks';
import { getClient, hasStoredSession } from '../lib/auth';
import { DISCUSSION_COLUMNS, jurisdictionLabel, targetHref, targetLabel } from '../lib/discussions';
import { paragraphs } from '../lib/format';
import { discussionHref } from '../lib/paths';
import { redirectIfPrerendered } from '../lib/prerendered';
import { select } from '../lib/rest';
import type { Discussion } from '../lib/types';
import PolisDiscussion from './PolisDiscussion';

/** Client-rendered page for discussions published since the last build (?id=slug). */
export default function DiscussionFallback() {
  const [d, setD] = useState<Discussion | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(id)) return setState('missing');
    (async () => {
      if (await redirectIfPrerendered((i) => (i.discussions.includes(id) ? discussionHref(id) : null))) return;
      let [row] = await select<Discussion>('discussions', { id: `eq.${id}`, select: DISCUSSION_COLUMNS });
      // Drafts are visible only to maintainers: retry with the signed-in session.
      if (!row && hasStoredSession()) {
        const client = await getClient();
        const { data } = await client.from('discussions').select(DISCUSSION_COLUMNS).eq('id', id).maybeSingle();
        row = (data as Discussion | null) ?? undefined;
      }
      if (!row) return setState('missing');
      setD(row);
      setState('ready');
      document.title = `${row.title} · ${document.title.split(' · ').pop()}`;
    })().catch(() => setState('error'));
  }, []);

  if (state === 'loading') return <p aria-live="polite">Loading…</p>;
  if (state === 'missing') return <p class="notice">We couldn’t find that discussion.</p>;
  if (state === 'error' || !d) return <p class="notice error">Couldn’t load this discussion.</p>;
  const link = targetHref(d.target_type, d.target_id);
  return (
    <article>
      <p class="eyebrow">
        Discussion · {jurisdictionLabel(d)} ·{' '}
        {d.status === 'open' ? 'Open' : d.status === 'closed' ? 'Closed' : 'Draft'}
      </p>
      <h1>{d.title}</h1>
      {paragraphs(d.prompt).map((p) => (
        <p>{p}</p>
      ))}
      {link && (
        <p class="small">
          About <a href={link}>{targetLabel(d.target_type, d.target_id)}</a>
        </p>
      )}
      <PolisDiscussion {...d} />
    </article>
  );
}
