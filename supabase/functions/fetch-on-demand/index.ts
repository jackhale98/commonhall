/**
 * Public, per request: a bill or member that is not in the database (older
 * Congresses, or a bill newer than the last sync). Called from the site's
 * fallback pages:
 *
 *   GET  /functions/v1/fetch-on-demand?kind=bill&id=118-hr-1
 *   POST /functions/v1/fetch-on-demand  {"kind":"member","id":"A000375"}
 *
 * Results are cached in archive_cache; uncached lookups share an hourly cap so
 * visitors cannot exhaust the Congress.gov budget.
 */
import { BudgetExhaustedError, CongressClient, HttpError, RequestBudget } from '@civic/congress-client';
import { OnDemandError, getOnDemand, validateRequest } from '@civic/sync';
import { connect, env, log } from '../_shared/runtime.ts';

const logger = log('fetch-on-demand');

function cors(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get('SITE_ORIGINS') ?? '*').split(',').map((s) => s.trim());
  const allow = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : (allowed[0] ?? '');
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, apikey, authorization, x-client-info',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('origin')), 'content-type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const respond = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

  let kind: unknown;
  let id: unknown;
  if (req.method === 'GET') {
    const url = new URL(req.url);
    kind = url.searchParams.get('kind');
    id = url.searchParams.get('id');
  } else if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    kind = body?.kind;
    id = body?.id;
  } else {
    return respond({ error: 'method not allowed' }, 405);
  }

  let request;
  try {
    request = validateRequest(kind, id);
  } catch (error) {
    return respond({ error: (error as Error).message }, 400);
  }

  const sql = connect();
  try {
    const apiKey = env('CONGRESS_API_KEY');
    const result = await getOnDemand(
      sql,
      (cap) => new CongressClient({ apiKey, budget: new RequestBudget(cap, 'congress'), maxAttempts: 3 }),
      request.kind,
      request.id,
    );
    return respond(result, 200, { 'cache-control': 'public, max-age=300' });
  } catch (error) {
    if (error instanceof OnDemandError) return respond({ error: error.message }, error.status);
    if (error instanceof HttpError && error.status === 404) return respond({ error: 'Not found on Congress.gov' }, 404);
    if (error instanceof BudgetExhaustedError) return respond({ error: 'Busy; try again later.' }, 429);
    logger('failed', {
      error: error instanceof Error ? error.message : String(error),
      kind: request.kind,
      id: request.id,
    });
    return respond({ error: 'Lookup failed' }, 502);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
});
