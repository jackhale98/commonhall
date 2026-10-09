/**
 * Public: Find my reps. POST {"address": "1600 Pennsylvania Ave NW, Washington, DC"}.
 * Returns districts, senators and House member, and state legislators.
 * The address is used for this request only: it is not stored or logged.
 */
import { CensusGeocoder, OpenStatesClient, congressForDate } from '@civic/congress-client';
import { findReps } from '@civic/sync';
import { connect, log } from '../_shared/runtime.ts';

const logger = log('geocode');

function cors(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get('SITE_ORIGINS') ?? '*').split(',').map((s) => s.trim());
  const allow = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : (allowed[0] ?? '');
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, apikey, authorization, x-client-info',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

Deno.serve(async (req) => {
  const headers = {
    ...cors(req.headers.get('origin')),
    'content-type': 'application/json',
    'cache-control': 'no-store',
  };
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return respond({ error: 'method not allowed' }, 405);

  const body = await req.json().catch(() => ({}));
  const address = typeof body?.address === 'string' ? body.address.trim() : '';
  if (address.length < 5 || address.length > 200) {
    return respond({ error: 'Enter a street address, city and state (or ZIP code).' }, 400);
  }
  // The Census geocoder needs a house number and street; a ZIP code can span several districts.
  if (!/\d+\s+\S/.test(address.replace(/\b\d{5}(-\d{4})?\b/g, '').trim())) {
    return respond(
      {
        error:
          'A ZIP code alone isn’t enough: one ZIP can cover several districts. Enter your street address, for example “123 Main St, Boston, MA”.',
      },
      400,
    );
  }

  const key = Deno.env.get('OPENSTATES_API_KEY');
  const sql = connect();
  try {
    const result = await findReps(
      sql,
      {
        census: new CensusGeocoder(),
        openstates: key
          ? (budget) => new OpenStatesClient({ apiKey: key, budget, minIntervalMs: 0, maxAttempts: 2 })
          : undefined,
      },
      address,
      congressForDate(new Date()),
    );
    if (!result)
      return respond(
        {
          error:
            'We couldn’t find that address. Check the house number and street, and include the city and state or ZIP code.',
        },
        404,
      );
    return respond(result);
  } catch (error) {
    logger('failed', { error: error instanceof Error ? error.message : String(error) });
    return respond({ error: 'Lookup failed; please try again.' }, 502);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
});
