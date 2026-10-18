/**
 * URL checks shared by the syncs and the site (CLAUDE.md rule 3). Upstream data
 * (Open States, Legistar, PrimeGov, CivicClerk, Congress.gov, CourtListener, city
 * sites) can carry any string in a URL field; only http: and https: links are kept,
 * so a `javascript:` or `data:` value never reaches an href or src.
 */

/** The URL, normalized, when it is an absolute http(s) URL; otherwise null. Relative URLs resolve against `base` when one is given. */
export function safeUrl(value: string | null | undefined, base?: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

/**
 * Where to go after signing in: a path on this site, or null. `/\evil.com` and
 * `//evil.com` are other sites to a browser, so the path is resolved against the
 * site's origin and kept only when it stays there.
 */
export function safeNext(next: string | null | undefined, origin: string): string | null {
  if (!next || !next.startsWith('/')) return null;
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
