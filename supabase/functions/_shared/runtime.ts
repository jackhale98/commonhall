/**
 * Shared plumbing for the sync Edge Functions: secret check, database
 * connection, time limits and JSON responses. API keys are read from function
 * secrets only and never returned or logged.
 */
import postgres from 'postgres';
import type { Sql } from '@civic/sync';

export function env(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ?? fallback;
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function envNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  const value = raw ? Number(raw) : fallback;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/**
 * Scheduled functions are invoked by pg_cron with `x-sync-secret`. They are
 * deployed with verify_jwt = false, so this check is the only gate.
 */
export function authorize(req: Request): Response | null {
  const expected = Deno.env.get('SYNC_SECRET');
  const given = req.headers.get('x-sync-secret') ?? '';
  if (!expected || !timingSafeEqual(given, expected)) {
    return json({ error: 'unauthorized' }, 401);
  }
  return null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function connect(): Sql {
  return postgres(env('SUPABASE_DB_URL'), {
    max: 4,
    prepare: false, // safe behind a transaction-mode pooler
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
  }) as unknown as Sql;
}

/** Wall-clock allowance per run; the free plan stops functions at 150 s. */
export function timeLimitMs(): number {
  return envNumber('SYNC_TIME_LIMIT_MS', 120_000);
}

export function log(fn: string) {
  return (message: string, data?: Record<string, unknown>) =>
    console.log(JSON.stringify({ fn, message, ...(data ?? {}) }));
}

/** Run a scheduled job handler with auth, a DB connection and error reporting. */
export function serveJob(
  fn: string,
  handler: (ctx: { sql: Sql; req: Request; log: ReturnType<typeof log> }) => Promise<unknown>,
) {
  Deno.serve(async (req) => {
    const denied = authorize(req);
    if (denied) return denied;
    const sql = connect();
    const logger = log(fn);
    try {
      const result = await handler({ sql, req, log: logger });
      return json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger('failed', { error: message });
      return json({ ok: false, error: message }, 500);
    } finally {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  });
}
