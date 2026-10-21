/**
 * The account page's passkeys: add one for this device, see each with when it was
 * added and last used, and remove any. Hidden where the browser can't use passkeys.
 */
import { useEffect, useState } from 'preact/hooks';
import { getClient } from '../lib/auth';
import { formatDate } from '../lib/format';
import { deviceName, isCancel, passkeyMessage, passkeysEnabled, passkeysSupported } from '../lib/passkeys';

interface Passkey {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
}

export default function PasskeyPanel() {
  const [supported, setSupported] = useState(false);
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    const client = await getClient();
    const { data, error: err } = await client.auth.passkey.list();
    if (err) throw err;
    setPasskeys((data ?? []) as Passkey[]);
  }

  useEffect(() => {
    if (!passkeysSupported()) return;
    passkeysEnabled().then((on) => {
      setSupported(on);
      if (on) load().catch(() => setPasskeys([]));
    });
  }, []);

  async function add() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const client = await getClient();
      const { data, error: err } = await client.auth.registerPasskey();
      if (err) throw err;
      // Name it for the device it was made on; the list still works if this fails.
      const name = deviceName(navigator.userAgent);
      if (data?.id && name)
        await client.auth.passkey.update({ passkeyId: data.id, friendlyName: name }).catch(() => undefined);
      setNotice('Passkey added. Next time, choose “Sign in with a passkey”.');
      await load();
    } catch (err) {
      if (!isCancel(err)) setError(passkeyMessage(err, 'add'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(passkey: Passkey) {
    if (!window.confirm('Remove this passkey? You can still sign in with an email link.')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const client = await getClient();
      const { error: err } = await client.auth.passkey.delete({ passkeyId: passkey.id });
      if (err) throw err;
      await load();
    } catch {
      setError('The passkey couldn’t be removed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!supported || passkeys === null) return null;
  return (
    <div class="card stack passkeys">
      <h2 class="h-small">Passkeys</h2>
      <p class="muted">
        {passkeys.length
          ? 'Sign in with Face ID, Touch ID, Windows Hello or your phone instead of an email link.'
          : 'Sign in faster next time with Face ID, Touch ID, Windows Hello or your phone instead of waiting for an email. The email link still works.'}
      </p>
      {notice && (
        <p class="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p class="notice error" role="alert">
          {error}
        </p>
      )}
      {passkeys.length > 0 && (
        <ul class="passkey-list">
          {passkeys.map((p) => (
            <li key={p.id}>
              <span>
                <strong>{p.friendly_name || 'Passkey'}</strong>
                <span class="small muted">
                  {' '}
                  Added {formatDate(p.created_at.slice(0, 10))}
                  {p.last_used_at && `, last used ${formatDate(p.last_used_at.slice(0, 10))}`}
                </span>
              </span>
              <button type="button" class="link-button" onClick={() => remove(p)} disabled={busy}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p>
        <button type="button" onClick={add} disabled={busy}>
          {passkeys.length ? 'Add a passkey on this device' : 'Add a passkey'}
        </button>
      </p>
    </div>
  );
}
