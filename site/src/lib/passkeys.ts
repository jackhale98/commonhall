/**
 * Passkeys beside the email link (docs/decisions.md §127): a passkey is added to an
 * account after an email sign-in and then signs in with Face ID, Touch ID, Windows
 * Hello or a phone. The email link stays the way to create an account and to get back
 * in without a passkey. Supabase Auth does the WebAuthn ceremonies.
 */

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let enabled: Promise<boolean> | undefined;

/**
 * Whether the project has passkeys switched on (Supabase Auth's public settings), asked
 * once per page. They are switched on in the dashboard, so until then the site shows
 * no passkey buttons rather than ones that fail.
 */
export function passkeysEnabled(): Promise<boolean> {
  enabled ??= fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
    .then((r) => (r.ok ? (r.json() as Promise<{ passkeys_enabled?: boolean }>) : null))
    .then((settings) => settings?.passkeys_enabled === true)
    .catch(() => false);
  return enabled;
}

/** Whether this browser can use passkeys at all. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

/** Whether the browser can offer passkeys in the email field's autofill (WebAuthn Conditional UI). */
export async function autofillSupported(): Promise<boolean> {
  if (!passkeysSupported() || !(await passkeysEnabled())) return false;
  const check = (window.PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> })
    .isConditionalMediationAvailable;
  try {
    return typeof check === 'function' ? await check() : false;
  } catch {
    return false;
  }
}

/**
 * Every code and name on the error and its causes: the library wraps the browser's
 * DOMException ("NotAllowedError" when the prompt is closed) as
 * ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY with the original as its cause.
 */
function codeOf(error: unknown, depth = 0): string {
  if (!error || typeof error !== 'object' || depth > 3) return '';
  const e = error as { code?: unknown; name?: unknown; error_code?: unknown; cause?: unknown };
  const own = [e.code, e.error_code, e.name].filter((v): v is string => typeof v === 'string' && v !== '');
  return [...own, codeOf(e.cause, depth + 1)].filter(Boolean).join(' ');
}

/** The person closed the prompt, or another ceremony replaced this one: nothing to say. */
export function isCancel(error: unknown): boolean {
  return /NotAllowedError|AbortError|ERROR_CEREMONY_ABORTED/.test(codeOf(error));
}

/** The challenge timed out while the autofill prompt waited: start again quietly. */
export function isExpired(error: unknown): boolean {
  return /webauthn_challenge_expired/.test(codeOf(error));
}

/**
 * Whether an autofill sign-in failed after someone chose a passkey (the server
 * rejected it), rather than in the background (offline, blocked, nothing chosen):
 * only the first is worth a message.
 */
export function isRejected(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/** What to tell someone when a passkey step fails. */
export function passkeyMessage(error: unknown, action: 'sign-in' | 'add'): string {
  const code = codeOf(error);
  if (/passkey_disabled/.test(code)) return 'Passkeys aren’t available here yet. Use the email link.';
  if (/InvalidStateError|ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED/.test(code))
    return 'This device already has a passkey for your account.';
  if (/SecurityError|ERROR_INVALID_DOMAIN|ERROR_INVALID_RP_ID/.test(code))
    return 'This browser won’t use passkeys on this page.';
  if (action === 'sign-in')
    return 'That passkey didn’t sign you in. If you haven’t added one yet, use the email link, then add a passkey in your account.';
  return 'The passkey couldn’t be added. Please try again.';
}

/** A name for a new passkey from the kind of device ("iPhone", "Mac", "Windows"), so the list tells them apart. */
export function deviceName(userAgent: string): string | null {
  const ua = userAgent.toLowerCase();
  if (ua.includes('iphone')) return 'iPhone';
  if (ua.includes('ipad')) return 'iPad';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('cros')) return 'Chromebook';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'Mac';
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('linux')) return 'Linux';
  return null;
}
