/**
 * Job runner: takes the job's lease, records start/success/error and requests
 * used in `sync_state`, and charges every upstream request to the shared hourly
 * `api_usage` counter. Jobs receive a deadline so they can stop cleanly before
 * an Edge Function's wall-clock limit and resume from their cursor next time.
 */
import { RequestBudget } from '@civic/congress-client';
import type { Sql } from './db.ts';

export type Cursor = Record<string, unknown>;

export interface JobRun<C extends Cursor = Cursor> {
  job: string;
  sql: Sql;
  cursor: C;
  /** Epoch ms after which the job should checkpoint and stop. */
  deadline: number;
  rowsWritten: number;
  log: (message: string, data?: Record<string, unknown>) => void;
  /** True once the deadline has passed. */
  outOfTime(): boolean;
  /** Persist the cursor now (call periodically in long loops). */
  checkpoint(cursor: C): Promise<void>;
}

export interface JobResult<C extends Cursor = Cursor> {
  job: string;
  status: 'ok' | 'skipped' | 'error';
  reason?: string;
  cursor?: C;
  rowsWritten: number;
  requests: Record<string, number>;
  durationMs: number;
}

/** Hourly request ceilings per upstream API (a margin below the published limit). */
export const HOURLY_LIMITS: Record<string, number> = {
  congress: 4800,
  // api.data.gov personal keys allow 1,000 an hour on OpenFEC.
  fec: 900,
  // CourtListener's default for a token: 5 a minute, 50 an hour, 125 a day (rolling windows).
  courtlistener: 45,
};

/** Ceilings over the last 24 hours, for APIs with a daily limit. */
export const DAILY_LIMITS: Record<string, number> = {
  courtlistener: 110,
};

/**
 * A budget for `api` that respects both the job's own cap and what other jobs
 * have already used this hour.
 */
export async function hourlyBudget(sql: Sql, api: string, cap: number): Promise<RequestBudget> {
  const limit = HOURLY_LIMITS[api];
  if (limit === undefined) return new RequestBudget(cap, api);
  const [row] = await sql<{ used: number }[]>`select public.api_usage_this_hour(${api}) as used`;
  let allowed = Math.min(cap, limit - (row?.used ?? 0));
  const daily = DAILY_LIMITS[api];
  if (daily !== undefined) {
    const [day] = await sql<{ used: number }[]>`
      select coalesce(sum(requests), 0)::int as used from public.api_usage
       where api = ${api} and hour > now() - interval '24 hours'`;
    allowed = Math.min(allowed, daily - (day?.used ?? 0));
  }
  return new RequestBudget(Math.max(0, allowed), api);
}

export interface RunJobOptions<C extends Cursor> {
  sql: Sql;
  job: string;
  /** Wall-clock allowance for this run in ms. */
  timeLimitMs: number;
  /** Budgets to charge to `api_usage` when the run ends, keyed by API name. */
  budgets?: Record<string, RequestBudget>;
  /** Lease length; defaults to timeLimitMs + 5 minutes. */
  leaseMs?: number;
  holder?: string;
  log?: (message: string, data?: Record<string, unknown>) => void;
  run: (ctx: JobRun<C>) => Promise<C>;
}

export async function getCursor<C extends Cursor>(sql: Sql, job: string): Promise<C> {
  const [row] = await sql<{ cursor: C }[]>`select cursor from public.sync_state where job = ${job}`;
  return (row?.cursor ?? {}) as C;
}

export async function setCursor(sql: Sql, job: string, cursor: Cursor): Promise<void> {
  await sql`
    insert into public.sync_state (job, cursor, updated_at)
    values (${job}, ${sql.json(cursor as never)}, now())
    on conflict (job) do update set cursor = excluded.cursor, updated_at = now()`;
}

export async function runJob<C extends Cursor>(options: RunJobOptions<C>): Promise<JobResult<C>> {
  const { sql, job } = options;
  const started = Date.now();
  const holder = options.holder ?? `${job}:${started}:${Math.random().toString(36).slice(2, 8)}`;
  const leaseMs = options.leaseMs ?? options.timeLimitMs + 5 * 60_000;
  const log = options.log ?? ((message, data) => console.log(JSON.stringify({ job, message, ...(data ?? {}) })));
  const budgets = options.budgets ?? {};
  const requests = () => Object.fromEntries(Object.entries(budgets).map(([k, b]) => [k, b.used]));

  const [lock] = await sql<{ ok: boolean }[]>`
    select public.try_sync_lock(${job}, ${holder}, make_interval(secs => ${leaseMs / 1000})) as ok`;
  if (!lock?.ok) {
    log('skipped: another run holds the lock');
    return { job, status: 'skipped', reason: 'locked', rowsWritten: 0, requests: {}, durationMs: Date.now() - started };
  }

  await sql`
    insert into public.sync_state (job, last_started_at) values (${job}, now())
    on conflict (job) do update set last_started_at = now(), updated_at = now()`;

  // Usage is charged incrementally (at each checkpoint and at the end) so a run
  // killed at the platform's wall-clock limit still accounts for most requests.
  const charged: Record<string, number> = {};
  const chargeUsage = async () => {
    for (const [api, budget] of Object.entries(budgets)) {
      const delta = budget.used - (charged[api] ?? 0);
      if (delta > 0) {
        await sql`select public.record_api_usage(${api}, ${delta})`;
        charged[api] = budget.used;
      }
    }
  };

  const ctx: JobRun<C> = {
    job,
    sql,
    cursor: await getCursor<C>(sql, job),
    deadline: started + options.timeLimitMs,
    rowsWritten: 0,
    log,
    outOfTime: () => Date.now() >= started + options.timeLimitMs,
    checkpoint: async (cursor) => {
      ctx.cursor = cursor;
      await setCursor(sql, job, cursor);
      await chargeUsage();
    },
  };

  try {
    const cursor = await options.run(ctx);
    const total = Object.values(requests()).reduce((a, b) => a + b, 0);
    await sql`
      update public.sync_state
         set cursor = ${sql.json(cursor as never)},
             last_success_at = now(),
             last_error = null,
             requests_used = ${total},
             rows_written = ${ctx.rowsWritten},
             updated_at = now()
       where job = ${job}`;
    log('done', { rowsWritten: ctx.rowsWritten, requests: requests(), ms: Date.now() - started });
    return {
      job,
      status: 'ok',
      cursor,
      rowsWritten: ctx.rowsWritten,
      requests: requests(),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const total = Object.values(requests()).reduce((a, b) => a + b, 0);
    await sql`
      update public.sync_state
         set last_error = ${message.slice(0, 2000)}, last_error_at = now(),
             requests_used = ${total}, rows_written = ${ctx.rowsWritten}, updated_at = now()
       where job = ${job}`.catch(() => undefined);
    log('error', { error: message });
    return {
      job,
      status: 'error',
      reason: message,
      rowsWritten: ctx.rowsWritten,
      requests: requests(),
      durationMs: Date.now() - started,
    };
  } finally {
    await chargeUsage().catch(() => undefined);
    await sql`select public.release_sync_lock(${job}, ${holder})`.catch(() => undefined);
  }
}
