import { useEffect, useRef, useState } from 'preact/hooks';
import { accountUrl, hasStoredSession, polisProfile, type PolisProfile } from '../lib/auth';
import { DEMO, POLIS_EMBED_URL, POLIS_SITE_ID, hasSupabase } from '../lib/config';
import { isAcceptingInput, jurisdictionLabel, meetsResidency } from '../lib/discussions';
import { href } from '../lib/paths';
import type { Discussion } from '../lib/types';

type Props = Pick<
  Discussion,
  'id' | 'title' | 'status' | 'jurisdiction' | 'district' | 'residency_required' | 'opens_at' | 'closes_at'
>;

type Viewer =
  { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'signed-in'; profile: PolisProfile } | { kind: 'error' };

/**
 * A hosted Pol.is conversation. Privacy rules (see /privacy/ and docs/discussions.md):
 * - the only user identifier sent is profiles.polis_xid, a random UUID, and only when signed in;
 * - parent_url is this page's clean URL, never the query string or fragment;
 * - document.referrer is reduced to this site's origin before embed.js reads it.
 */
const enabled = Boolean(POLIS_SITE_ID);
// The demo build has no accounts, so its example discussions are an open preview:
// anyone may vote and write, and no user identifier exists to send.
const preview = DEMO;

export default function PolisDiscussion(props: Props) {
  const [viewer, setViewer] = useState<Viewer>({ kind: 'loading' });
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasSupabase || !hasStoredSession()) return setViewer({ kind: 'signed-out' });
    polisProfile()
      .then((profile) => setViewer(profile ? { kind: 'signed-in', profile } : { kind: 'signed-out' }))
      .catch(() => setViewer({ kind: 'error' }));
  }, []);

  const open = isAcceptingInput(props);
  const profile = viewer.kind === 'signed-in' ? viewer.profile : null;
  const resident = meetsResidency(props, profile);
  const canParticipate = open && (preview || (profile !== null && resident));

  useEffect(() => {
    if (!enabled || viewer.kind === 'loading' || !container.current) return;
    const div = document.createElement('div');
    div.className = 'polis';
    const data: Record<string, string> = {
      site_id: POLIS_SITE_ID,
      page_id: props.id,
      topic: props.title,
      parent_url: `${window.location.origin}${window.location.pathname}`,
      ucv: String(canParticipate),
      ucw: String(canParticipate),
      ucsf: 'false',
      show_vis: 'true',
      auth_needed_to_vote: 'false',
      auth_needed_to_write: 'false',
    };
    if (profile && canParticipate) data.xid = profile.xid;
    for (const [k, v] of Object.entries(data)) div.setAttribute(`data-${k}`, v);
    container.current.replaceChildren(div);

    try {
      Object.defineProperty(document, 'referrer', { value: `${window.location.origin}/`, configurable: true });
    } catch {
      // Not redefinable in this browser; the referrer is same-site anyway.
    }
    const script = document.createElement('script');
    script.src = POLIS_EMBED_URL;
    script.async = true;
    script.onerror = () => setFailed(true);
    document.body.appendChild(script);
    return () => script.remove();
  }, [viewer.kind, canParticipate, profile?.xid, props.id, props.title]);

  const notice = (() => {
    if (!open)
      return props.status === 'closed'
        ? 'This discussion is closed. You can still read the results.'
        : 'This discussion hasn’t opened yet.';
    if (preview) return 'preview';
    if (viewer.kind === 'loading') return null;
    if (viewer.kind === 'error') return 'Couldn’t check your account. You can read along; reload to take part.';
    if (!profile) return hasSupabase ? 'signed-out' : null;
    if (!resident) return 'not-resident';
    return null;
  })();

  return (
    <div class="discussion-embed">
      {notice === 'preview' ? (
        <p class="notice">
          <strong>Demo preview.</strong> Anyone can vote and add statements here. On the live site, taking part needs
          sign-in
          {props.residency_required && `, and this discussion is limited to residents of ${jurisdictionLabel(props)}`}.
        </p>
      ) : notice === 'signed-out' ? (
        <p class="notice">
          <a href={accountUrl(window.location.pathname)}>Sign in</a> to vote and add statements.
          {props.residency_required && ` Open to residents of ${jurisdictionLabel(props)}.`}
        </p>
      ) : notice === 'not-resident' ? (
        <p class="notice">
          This discussion is for residents of {jurisdictionLabel(props)}. Save your address under{' '}
          <a href={href('#reps-h')}>Find my reps</a> to take part; you can still read along.
        </p>
      ) : (
        notice && <p class="notice">{notice}</p>
      )}
      {!enabled ? (
        <p class="notice">Discussions aren’t switched on for this copy of the site yet.</p>
      ) : failed ? (
        <p class="notice error">Couldn’t load the discussion from pol.is. Check your connection or content blocker.</p>
      ) : (
        <div ref={container} aria-busy={viewer.kind === 'loading'} />
      )}
    </div>
  );
}
