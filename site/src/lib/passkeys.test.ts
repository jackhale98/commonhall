import { describe, expect, it } from 'vitest';
import { deviceName, isCancel, isExpired, isRejected, passkeyMessage } from './passkeys';

/** The shapes supabase-js gives: a WebAuthnError wrapping the browser's DOMException, or an AuthApiError. */
const wrapped = (name: string) =>
  Object.assign(new Error('passthrough'), {
    code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
    cause: Object.assign(new Error(name), { name }),
  });
const api = (code: string, status: number) => Object.assign(new Error(code), { code, status });

describe('passkeys', () => {
  it('stay quiet when the prompt is closed or replaced', () => {
    expect(isCancel(wrapped('NotAllowedError'))).toBe(true);
    expect(isCancel(Object.assign(new Error('x'), { code: 'ERROR_CEREMONY_ABORTED' }))).toBe(true);
    expect(isCancel(api('webauthn_verification_failed', 400))).toBe(false);
  });

  it('start the autofill again when its challenge expires, and speak up only when a chosen passkey is refused', () => {
    expect(isExpired(api('webauthn_challenge_expired', 400))).toBe(true);
    expect(isRejected(api('webauthn_verification_failed', 400))).toBe(true);
    // Offline or blocked: no status, nothing to say.
    expect(isRejected(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('explain failures in plain words', () => {
    expect(passkeyMessage(api('passkey_disabled', 404), 'sign-in')).toMatch(/aren’t available/);
    expect(passkeyMessage(wrapped('InvalidStateError'), 'add')).toMatch(/already has a passkey/);
    expect(passkeyMessage(api('webauthn_verification_failed', 400), 'sign-in')).toMatch(/use the email link/);
  });

  it('name a new passkey for the device it was made on', () => {
    expect(
      deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile'),
    ).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe('Mac');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0')).toBe('Windows');
    expect(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141.0 Mobile')).toBe('Android');
    expect(deviceName('curl/8.0')).toBeNull();
  });
});
