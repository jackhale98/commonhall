/**
 * Deletes the calling user's account. The user is identified from their own
 * access token; deletion uses the Auth admin API with the service-role key that
 * Supabase provides to Edge Functions. Follows, profile and read markers are
 * removed by ON DELETE CASCADE.
 */
import { env, log } from '../_shared/runtime.ts';

const logger = log('delete-account');

function cors(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get('SITE_ORIGINS') ?? '*').split(',').map((s) => s.trim());
  const allow = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : (allowed[0] ?? '');
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    vary: 'origin',
  };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('origin')), 'content-type': 'application/json' };
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return respond({ error: 'method not allowed' }, 405);

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return respond({ error: 'unauthorized' }, 401);

  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');

  // Who is calling? GoTrue validates the token.
  const who = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
  if (!who.ok) return respond({ error: 'unauthorized' }, 401);
  const user = (await who.json()) as { id?: string };
  if (!user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) return respond({ error: 'unauthorized' }, 401);

  const res = await fetch(`${base}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) {
    logger('delete failed', { status: res.status });
    return respond({ error: 'could not delete account' }, 502);
  }
  logger('account deleted');
  return respond({ ok: true });
});
