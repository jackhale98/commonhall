import { useEffect, useRef, useState } from 'preact/hooks';
import { accountUrl, hasStoredSession, polisProfile, type PolisProfile } from '../lib/auth';
import { DEMO, OPEN_PARTICIPATION, POLIS_ORIGIN, POLIS_SITE_ID, hasSupabase } from '../lib/config';
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
 * A hosted Pol.is conversation, in an iframe we build ourselves (no Pol.is script runs
 * in this page, so nothing from Pol.is can read the page or the session in
 * localStorage). Privacy rules (see /privacy/ and docs/discussions.md):
 * - the only user identifier sent is profiles.polis_xid, a random UUID, and only when signed in;
 * - parent_url is this page's clean URL, never the query string or fragment;
 * - the referrer is this site's origin only (referrerpolicy="origin").
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
  // Signed-out visitors take part as anonymous Pol.is participants (Pol.is's own cookie, no xid).
  const canParticipate = open && (preview || OPEN_PARTICIPATION || (profile !== null && resident));

  useEffect(() => {
    if (!enabled || viewer.kind === 'loading' || !container.current) return;
    // The same address Pol.is's embed.js builds: /{site_id}/{page_id}, with the options as a query.
    const params: Record<string, string> = {
      parent_url: `${window.location.origin}${window.location.pathname}`,
      referrer: `${window.location.origin}/`,
      ucv: String(canParticipate),
      ucw: String(canParticipate),
      ucsf: 'false',
      // The page already shows the title and prompt; don't repeat Pol.is's topic and description.
      ucst: 'false',
      ucsd: 'false',
      show_vis: 'true',
      auth_needed_to_vote: 'false',
      auth_needed_to_write: 'false',
      topic: props.title,
    };
    if (profile && canParticipate) params.xid = profile.xid;
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const frame = document.createElement('iframe');
    frame.src = `${POLIS_ORIGIN}/${encodeURIComponent(POLIS_SITE_ID)}/${encodeURIComponent(props.id)}?${query}`;
    frame.id = `polis_${POLIS_SITE_ID}_${props.id}`;
    frame.title = `Discussion: ${props.title}`;
    frame.className = 'polis-frame';
    frame.width = '100%';
    frame.height = '930';
    frame.referrerPolicy = 'origin';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    frame.onerror = () => setFailed(true);
    container.current.replaceChildren(frame);

    // Pol.is posts its content height; grow the frame to fit (never shrink, as embed.js does).
    let tallest = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== POLIS_ORIGIN || event.source !== frame.contentWindow) return;
      const data = event.data as { name?: string; height?: number } | null;
      if (data?.name === 'resize' && typeof data.height === 'number' && data.height > tallest) {
        tallest = data.height;
        frame.height = String(Math.round(data.height));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [viewer.kind, canParticipate, profile?.xid, props.id, props.title]);

  const notice = (() => {
    if (!open)
      return props.status === 'closed'
        ? 'This discussion is closed. You can still read the results.'
        : 'This discussion hasn’t opened yet.';
    if (preview) return 'preview';
    if (viewer.kind === 'loading') return null;
    if (viewer.kind === 'error') return 'Couldn’t check your account. You can read along; reload to take part.';
    if (OPEN_PARTICIPATION) return props.residency_required ? 'residents-asked' : null;
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
      ) : notice === 'residents-asked' ? (
        <p class="notice">
          This discussion is meant for residents of {jurisdictionLabel(props)}. Please take part only if you live there.
        </p>
      ) : notice === 'not-resident' ? (
        <p class="notice">
          This discussion is for residents of {jurisdictionLabel(props)}. Save your address under{' '}
          <a href={href('reps/')}>Find my reps</a> to take part; you can still read along.
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
