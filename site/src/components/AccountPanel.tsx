import { useEffect, useRef, useState } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import { followMany, getClient, safeNext, takePendingFollow } from '../lib/auth';
import { SUPABASE_URL, hasSupabase } from '../lib/config';
import {
  autofillSupported,
  isCancel,
  isExpired,
  isRejected,
  passkeyMessage,
  passkeysEnabled,
  passkeysSupported,
} from '../lib/passkeys';
import { href } from '../lib/paths';
import AdminLink from './AdminLink';
import FindMyReps from './FindMyReps';
import PasskeyPanel from './PasskeyPanel';

type Phase = 'loading' | 'signed-out' | 'sent' | 'signed-in' | 'deleted' | 'unconfigured';

export default function AccountPanel() {
  const [phase, setPhase] = useState<Phase>(hasSupabase ? 'loading' : 'unconfigured');
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [canPasskey, setCanPasskey] = useState(false);
  const autofill = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!hasSupabase) return;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const hashError = new URLSearchParams(window.location.hash.slice(1)).get('error_description');
      if (hashError) setError(`Sign-in link problem: ${hashError}. Request a new link below.`);
      const client = await getClient();
      const { data } = await client.auth.getSession();
      await settle(data.session);
      const sub = client.auth.onAuthStateChange((_event, next) => {
        setSession(next);
        setPhase(next ? 'signed-in' : 'signed-out');
      });
      unsubscribe = () => sub.data.subscription.unsubscribe();
    })().catch(() => {
      setError('Could not reach the sign-in service.');
      setPhase('signed-out');
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (passkeysSupported()) passkeysEnabled().then(setCanPasskey);
  }, []);

  // While the sign-in form is up, the browser may offer this site's passkeys in the email
  // field's autofill (WebAuthn Conditional UI); choosing one signs in without the button.
  useEffect(() => {
    if (phase !== 'signed-out') return;
    const controller = new AbortController();
    autofill.current = controller;
    (async () => {
      if (!(await autofillSupported())) return;
      const client = await getClient();
      for (let attempt = 0; attempt < 3 && !controller.signal.aborted; attempt++) {
        const { data, error: err } = await client.auth.signInWithPasskey({
          options: { mediation: 'conditional', signal: controller.signal },
        });
        if (data?.session) return settle(data.session);
        if (!err || isCancel(err) || controller.signal.aborted) return;
        // The challenge expires after five minutes while the autofill waits: ask for a new one.
        if (isExpired(err)) continue;
        // Only a passkey someone chose and the server refused is worth a message here.
        if (isRejected(err)) setError(passkeyMessage(err, 'sign-in'));
        return;
      }
    })().catch(() => undefined);
    return () => controller.abort();
  }, [phase]);

  async function passkeySignIn() {
    autofill.current?.abort();
    setError('');
    setBusy(true);
    try {
      const client = await getClient();
      const { data, error: err } = await client.auth.signInWithPasskey();
      if (err) throw err;
      await settle(data?.session ?? null);
    } catch (err) {
      if (!isCancel(err)) setError(passkeyMessage(err, 'sign-in'));
    } finally {
      setBusy(false);
    }
  }

  /** After sign-in: finish a follow started while signed out, then go back. */
  async function settle(current: Session | null) {
    setSession(current);
    if (!current) {
      setPhase('signed-out');
      return;
    }
    if (window.location.hash.includes('access_token')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    const pending = takePendingFollow();
    const next = safeNext(new URLSearchParams(window.location.search).get('next'));
    if (pending) {
      try {
        await followMany(pending.targets);
      } catch {
        setNotice('You are signed in, but we could not complete those follows. Try the Follow button again.');
      }
      const destination = safeNext(pending.returnTo) ?? next;
      if (destination) {
        window.location.replace(destination);
        return;
      }
    } else if (next) {
      window.location.replace(next);
      return;
    }
    setPhase('signed-in');
  }

  async function sendLink(e: Event) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const client = await getClient();
      const next = safeNext(new URLSearchParams(window.location.search).get('next'));
      const redirect = new URL(href('account/'), window.location.origin);
      if (next) redirect.searchParams.set('next', next);
      const { error: err } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirect.toString(), shouldCreateUser: true },
      });
      if (err) throw err;
      setPhase('sent');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/rate limit/i.test(message) ? 'Too many sign-in emails were sent. Please wait a few minutes.' : message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const client = await getClient();
    await client.auth.signOut();
    try {
      sessionStorage.removeItem('civic.is-admin');
    } catch {
      // Ignore.
    }
    setPhase('signed-out');
  }

  async function deleteAccount() {
    if (!session) return;
    const ok = window.confirm(
      'Delete your account? This removes your follows, saved address and feed history. It cannot be undone.',
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/delete-account`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) throw new Error(`Delete failed (${response.status})`);
      const client = await getClient();
      await client.auth.signOut({ scope: 'local' });
      setPhase('deleted');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'unconfigured') {
    return <p class="notice">Accounts are not available on this build (no Supabase project configured).</p>;
  }
  if (phase === 'loading') return <p aria-live="polite">Checking your sign-in…</p>;
  if (phase === 'deleted') return <p class="notice">Your account and everything attached to it have been deleted.</p>;

  if (phase === 'sent') {
    return (
      <div class="card stack" aria-live="polite">
        <h2 class="h-small">Check your email</h2>
        <p>
          We sent a sign-in link to <strong>{email}</strong>. Open it on this device or any other; it expires in an
          hour.
        </p>
        <button type="button" class="link-button" onClick={() => setPhase('signed-out')}>
          Use a different email
        </button>
      </div>
    );
  }

  if (phase === 'signed-out') {
    return (
      <form class="card stack signin" onSubmit={sendLink}>
        <h2 class="h-small">Sign in or create an account</h2>
        <p class="muted">
          We’ll email you a link. No password needed.
          {canPasskey && ' Added a passkey before? Sign in with it below.'}
        </p>
        {error && (
          <p class="notice error" role="alert">
            {error}
          </p>
        )}
        <div class="field">
          <label for="email">Email address</label>
          <input
            id="email"
            type="email"
            autocomplete="email webauthn"
            required
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
          />
        </div>
        <button type="submit" class="primary" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </button>
        {canPasskey && (
          <button type="button" onClick={passkeySignIn} disabled={busy}>
            Sign in with a passkey
          </button>
        )}
      </form>
    );
  }

  return (
    <div class="stack">
      {notice && <p class="notice">{notice}</p>}
      {error && (
        <p class="notice error" role="alert">
          {error}
        </p>
      )}
      <div class="card stack">
        <p>
          Signed in as <strong>{session?.user.email}</strong>
        </p>
        <p class="cluster">
          <a class="button primary" href={href('feed/')}>
            Your feed
          </a>
          <a class="button" href={href('following/')}>
            Manage follows
          </a>
          <AdminLink variant="button" />
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </p>
      </div>
      <PasskeyPanel />
      <FindMyReps saved />
      <div class="card stack">
        <h2 class="h-small">Delete account</h2>
        <p class="muted">Removes your account, follows, saved address and feed history immediately.</p>
        <p>
          <button type="button" class="danger" onClick={deleteAccount} disabled={busy}>
            Delete my account
          </button>
        </p>
      </div>
    </div>
  );
}
