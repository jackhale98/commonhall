/**
 * Upstream record counts (public.source_totals), so the site can say when whole
 * records are still loading (public.data_coverage(), docs/decisions.md §126).
 */
import { BudgetExhaustedError, type CongressClient } from '@civic/congress-client';
import type { Sql } from '../db.ts';

/** How often a total is counted again. */
export const TOTAL_EVERY_MS = 20 * 60 * 60_000;

/** Store a source's upstream total. */
export async function recordSourceTotal(sql: Sql, source: string, expected: number, now: Date): Promise<void> {
  await sql`
    insert into public.source_totals (source, expected, counted_at)
    values (${source}, ${expected}, ${now.toISOString()})
    on conflict (source) do update set expected = excluded.expected, counted_at = excluded.counted_at`;
}

/**
 * Congress.gov's bill count for a Congress, at most once every 20 hours (one request).
 * Returns the count when it was read, null when the stored one is recent. A failed
 * read is logged and skipped: the total only labels pages, and an old one is ignored
 * there, so it must not stop the bill sync; running out of budget is passed on.
 */
export async function recordBillTotal(
  sql: Sql,
  client: CongressClient,
  congress: number,
  now: Date,
  log: (message: string, data?: Record<string, unknown>) => void = () => undefined,
): Promise<number | null> {
  const source = `bills:${congress}`;
  const [row] = await sql<{ counted_at: Date }[]>`
    select counted_at from public.source_totals where source = ${source}`;
  if (row && now.getTime() - new Date(row.counted_at).getTime() < TOTAL_EVERY_MS) return null;
  try {
    const expected = await client.billCount(congress);
    await recordSourceTotal(sql, source, expected, now);
    return expected;
  } catch (error) {
    if (error instanceof BudgetExhaustedError) throw error;
    log('could not count bills on Congress.gov; keeping the stored total', { error: String(error) });
    return null;
  }
}
