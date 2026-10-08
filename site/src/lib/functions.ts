import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabase } from './config';

export type OnDemandResult<T> =
  { ok: true; payload: T; cached: boolean } | { ok: false; status: number; error: string };

/** Ask the fetch-on-demand Edge Function for a bill or member we have not synced. */
export async function onDemand<T>(kind: 'bill' | 'member', id: string): Promise<OnDemandResult<T>> {
  if (!hasSupabase) return { ok: false, status: 503, error: 'Data service not configured.' };
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/fetch-on-demand?kind=${kind}&id=${encodeURIComponent(id)}`;
  const response = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } });
  const body = (await response.json().catch(() => ({}))) as { payload?: T; cached?: boolean; error?: string };
  if (!response.ok || !body.payload) {
    return { ok: false, status: response.status, error: body.error ?? `Lookup failed (${response.status}).` };
  }
  return { ok: true, payload: body.payload, cached: Boolean(body.cached) };
}
