/**
 * Per-client limits for public endpoints (CLAUDE.md rule 7): one hit counted in
 * private.rate_limits under a daily-salted hash of the caller's IP address
 * (migration 064), so no address is stored.
 */
import type { Sql } from './db.ts';

/** The caller's IP address from the request headers Supabase's gateway sets, or null. */
export function clientIp(headers: Headers): string | null {
  const raw = headers.get('cf-connecting-ip') ?? headers.get('x-real-ip') ?? headers.get('x-forwarded-for') ?? '';
  return raw.split(',')[0]!.trim() || null;
}

/** Count a hit for this client; false when it is over `max` in the current window. */
export async function withinClientLimit(
  sql: Sql,
  bucket: string,
  ip: string | null,
  max: number,
  windowSeconds = 3600,
): Promise<boolean> {
  if (!ip) return true;
  const [row] = await sql<{ ok: boolean }[]>`
    select private.hit_rate_limit(${bucket}, private.client_key(${ip}), ${max},
                                  make_interval(secs => ${windowSeconds})) as ok`;
  return row?.ok ?? true;
}
