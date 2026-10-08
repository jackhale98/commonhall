/**
 * Feed events for federal bills. Written once per upstream change (never per
 * follower) with a dedupe key, so reruns and overlapping windows are harmless.
 */
import { billLabel } from '@civic/congress-client';
import { insertMany, type AnySql } from '../db.ts';
import type { ActionRow, BillChange } from './bills.ts';

// The Library of Congress repeats chamber floor actions behind these prefixes;
// both copies map to the same dedupe key so followers see one event.
const LOC_PREFIX =
  /^(passed\/agreed to in (house|senate)|failed of passage\/not agreed to in (house|senate)|resolving differences -- (house|senate) actions): /i;

export function normalizeActionText(text: string): string {
  return text.replace(LOC_PREFIX, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Small stable hash (FNV-1a, 32-bit) to keep dedupe keys short. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Action dates are calendar dates (Eastern); noon UTC keeps them on the right day everywhere. */
function actionInstant(a: Pick<ActionRow, 'action_date' | 'action_time'>): string {
  if (!a.action_date) return new Date().toISOString();
  if (a.action_time) return new Date(`${a.action_date}T${a.action_time}-05:00`).toISOString();
  return `${a.action_date}T12:00:00.000Z`;
}

export interface FeedEventRow extends Record<string, unknown> {
  target_type: string;
  target_id: string;
  kind: 'action' | 'vote' | 'cosponsor' | 'new_bill';
  member_type: string | null;
  member_id: string | null;
  occurred_at: string;
  summary: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
}

export function billEvents(change: BillChange): FeedEventRow[] {
  const label = billLabel(change.billType, change.number);
  const events: FeedEventRow[] = [];

  if (change.isNew) {
    events.push({
      target_type: 'bill',
      target_id: change.id,
      kind: 'new_bill',
      member_type: change.sponsorId ? 'member' : null,
      member_id: change.sponsorId,
      occurred_at: change.introducedDate ? `${change.introducedDate}T12:00:00.000Z` : new Date().toISOString(),
      summary: `${label} introduced: ${change.title}`,
      payload: { label, title: change.title, status: change.statusAfter },
      dedupe_key: `new_bill:${change.id}`,
    });
  }

  for (const action of change.newActions) {
    const normalized = normalizeActionText(action.text);
    events.push({
      target_type: 'bill',
      target_id: change.id,
      kind: 'action',
      member_type: null,
      member_id: null,
      occurred_at: actionInstant(action),
      summary: `${label}: ${action.text}`,
      payload: {
        label,
        title: change.title,
        text: action.text,
        action_date: action.action_date,
        chamber: action.chamber,
        status: change.statusAfter,
        status_changed: change.statusBefore !== change.statusAfter,
      },
      dedupe_key: `action:${change.id}:${action.action_date ?? ''}:${hash(normalized)}`,
    });
  }

  for (const c of change.newCosponsors) {
    events.push({
      target_type: 'bill',
      target_id: change.id,
      kind: 'cosponsor',
      member_type: 'member',
      member_id: c.member_id,
      occurred_at: c.sponsored_date ? `${c.sponsored_date}T12:00:00.000Z` : new Date().toISOString(),
      summary: `New cosponsor for ${label}`,
      payload: { label, title: change.title, member_id: c.member_id, sponsored_date: c.sponsored_date },
      dedupe_key: `cosponsor:${change.id}:${c.member_id}`,
    });
  }

  // Within one change, keep the first event per key (the chamber and LoC copies).
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.dedupe_key) ? false : (seen.add(e.dedupe_key), true)));
}

/** Insert events, ignoring ones already recorded. Returns rows inserted. */
export async function writeFeedEvents(sql: AnySql, events: FeedEventRow[]): Promise<number> {
  // postgres.js serialises objects for jsonb parameters itself.
  return insertMany(sql, 'public.feed_events', events, true);
}
