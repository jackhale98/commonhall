/**
 * Minimal read-only PostgREST client used at build time and by public islands.
 * Public pages avoid supabase-js to stay small; it is loaded only for auth.
 */
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabase } from './config';

export class RestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RestError';
  }
}

export type Params = Record<string, string | number | undefined>;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { apikey: SUPABASE_ANON_KEY, accept: 'application/json', ...extra };
  // Legacy anon keys are JWTs and go in Authorization too; publishable keys must not.
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) h.authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  return h;
}

function url(path: string, params: Params = {}): string {
  const u = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
}

async function check(response: Response): Promise<Response> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new RestError(response.status, `Supabase ${response.status}: ${text.slice(0, 200)}`);
  }
  return response;
}

/** GET rows from a table or view. Pass PostgREST filters as params, e.g. `{ id: 'eq.119-hr-1' }`. */
export async function select<T>(table: string, params: Params = {}, init: RequestInit = {}): Promise<T[]> {
  if (!hasSupabase) return [];
  const response = await check(await fetch(url(table, params), { ...init, headers: headers() }));
  return (await response.json()) as T[];
}

/** Like select, plus the exact total count (for pagination UIs). */
export async function selectWithCount<T>(table: string, params: Params = {}): Promise<{ rows: T[]; count: number }> {
  if (!hasSupabase) return { rows: [], count: 0 };
  const response = await check(await fetch(url(table, params), { headers: headers({ prefer: 'count=exact' }) }));
  const range = response.headers.get('content-range') ?? '';
  const total = Number(range.split('/')[1]);
  const rows = (await response.json()) as T[];
  return { rows, count: Number.isFinite(total) ? total : rows.length };
}

export async function selectOne<T>(table: string, params: Params = {}): Promise<T | null> {
  const rows = await select<T>(table, { ...params, limit: 1 });
  return rows[0] ?? null;
}

/** Fetch every row, page by page (Supabase caps responses at 1,000 rows). */
export async function selectAll<T>(table: string, params: Params = {}, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await select<T>(table, { ...params, limit: pageSize, offset });
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

/** Call a Postgres function exposed through PostgREST. */
export async function rpc<T>(fn: string, args: Record<string, unknown>, params: Params = {}): Promise<T> {
  if (!hasSupabase) return [] as unknown as T;
  const response = await check(
    await fetch(url(`rpc/${fn}`, params), {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(args),
    }),
  );
  // Functions returning void answer 204 with no body.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Quote a value for a PostgREST `in.(…)` filter. */
export function inList(values: (string | number)[]): string {
  return `in.(${values.map((v) => `"${String(v).replace(/["\\]/g, '\\$&')}"`).join(',')})`;
}
