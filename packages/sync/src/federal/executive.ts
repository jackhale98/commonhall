/**
 * The executive branch: executive orders (Federal Register, no key) and
 * presidential nominations to the Senate (Congress.gov). One hourly job keeps
 * both current; each run costs a request or two once the first load is done.
 */
import {
  BudgetExhaustedError,
  type CongressClient,
  type FederalRegisterClient,
  type FrExecutiveOrder,
  type NominationListItem,
} from '@civic/congress-client';
import { upsertIfChanged, type Sql } from '../db.ts';
import type { JobRun } from '../job.ts';

export const EXECUTIVE_JOB = 'executive';

export interface ExecutiveCursor {
  [key: string]: unknown;
  /** Newest Federal Register publication date seen (YYYY-MM-DD). */
  ordersPublished?: string;
  /** Per Congress: when its nomination list was last read in full or incrementally (ISO). */
  nominations?: Record<string, string>;
}

// ---- Executive orders --------------------------------------------------------

export interface ExecutiveOrderRow extends Record<string, unknown> {
  document_number: string;
  eo_number: number | null;
  title: string;
  president: string | null;
  president_name: string | null;
  signing_date: string | null;
  publication_date: string;
  citation: string | null;
  html_url: string;
  pdf_url: string | null;
  abstract: string | null;
  notes: string | null;
  revokes: number[];
  revoked_by: number[];
}

/** EO numbers listed after a label in disposition notes, e.g. "Revokes: EO 14148, January 20, 2025; EO 14151". */
export function eoNumbersAfter(notes: string | null, label: RegExp): number[] {
  if (!notes) return [];
  const out: number[] = [];
  for (const part of notes.split(/(?=\b(?:Revokes|Revoked by|Amends|Amended by|See|Supersedes|Superseded by)\b)/)) {
    if (!label.test(part)) continue;
    for (const m of part.matchAll(/\bEO\s+(\d{4,5})\b/g)) out.push(Number(m[1]));
  }
  return [...new Set(out)];
}

export function executiveOrderRow(doc: FrExecutiveOrder): ExecutiveOrderRow {
  const n = doc.executive_order_number === null ? NaN : Number(doc.executive_order_number);
  const notes = doc.disposition_notes?.trim() || null;
  return {
    document_number: doc.document_number,
    eo_number: Number.isFinite(n) && n > 0 ? n : null,
    title: doc.title.trim(),
    president: doc.president?.identifier ?? null,
    president_name: doc.president?.name ?? null,
    signing_date: doc.signing_date,
    publication_date: doc.publication_date,
    citation: doc.citation,
    html_url: doc.html_url,
    pdf_url: doc.pdf_url,
    abstract: doc.abstract?.trim() || null,
    notes,
    revokes: eoNumbersAfter(notes, /^Revokes\b/),
    revoked_by: eoNumbersAfter(notes, /^Revoked by\b/),
  };
}

export async function syncExecutiveOrders(
  sql: Sql,
  client: FederalRegisterClient,
  since: string | undefined,
): Promise<{ written: number; newest: string | undefined }> {
  let written = 0;
  let newest = since;
  // Re-read the last two weeks: corrections and notes ("Revoked by") are added after publication.
  const from = since ? new Date(Date.parse(since) - 14 * 86_400_000).toISOString().slice(0, 10) : undefined;
  for await (const doc of client.executiveOrders({ publishedSince: from })) {
    if (await upsertIfChanged(sql, 'public.executive_orders', ['document_number'], executiveOrderRow(doc))) written++;
    if (!newest || doc.publication_date > newest) newest = doc.publication_date;
  }
  return { written, newest };
}

// ---- Nominations --------------------------------------------------------------

export type NominationStatus =
  | 'in_committee'
  | 'reported'
  | 'on_calendar'
  | 'floor'
  | 'confirmed'
  | 'rejected'
  | 'withdrawn'
  | 'returned'
  | 'received';

export interface NominationRow extends Record<string, unknown> {
  id: string;
  congress: number;
  number: number;
  part: number | null;
  citation: string;
  description: string | null;
  nominee: string | null;
  position: string | null;
  organization: string | null;
  is_military: boolean;
  received_date: string | null;
  latest_action_date: string | null;
  latest_action_text: string | null;
  status: NominationStatus;
  source_updated_at: string | null;
}

/** "119-pn373", or "119-pn615-2" for part 2 of a nomination split by the Senate. */
export function nominationId(congress: number, number: number | string, part?: number | string | null): string {
  const p = part === undefined || part === null ? 0 : Number(part);
  return `${congress}-pn${Number(number)}${p > 0 ? `-${p}` : ''}`;
}

/** The Senate's document number for a nomination: "373" or "615-2". */
export function nominationIdFromSenate(congress: number, documentNumber: string): string | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(documentNumber.trim());
  return m ? nominationId(congress, m[1]!, m[2] ?? null) : null;
}

/** Status from the latest Senate executive action text. */
export function nominationStatus(text: string | null | undefined): NominationStatus {
  const t = text ?? '';
  if (/confirmed by the senate/i.test(t)) return 'confirmed';
  if (/withdraw/i.test(t)) return 'withdrawn';
  if (/returned to the president/i.test(t)) return 'returned';
  if (/rejected|not confirmed/i.test(t)) return 'rejected';
  if (/cloture|motion to proceed|considered by senate|consideration/i.test(t)) return 'floor';
  if (/placed on senate executive calendar/i.test(t)) return 'on_calendar';
  if (/reported (favorably|by|without)|ordered to be reported/i.test(t)) return 'reported';
  if (/referred to the committee|received in the senate/i.test(t)) return 'in_committee';
  return 'received';
}

/** "Sara Carter Bailey, of Texas, to be Director of National Drug Control Policy, vice X." → name and position. */
export function parseNominationDescription(description: string | null | undefined): {
  nominee: string | null;
  position: string | null;
} {
  const d = (description ?? '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?), of (?:the )?[A-Z][^,]*?, to be (.+?)(?:, vice\b.*|\. ?\(.*|\.)?$/.exec(d);
  if (!m) return { nominee: null, position: null };
  return { nominee: m[1]!.trim(), position: m[2]!.replace(/[.,]$/, '').trim() };
}

export function nominationRow(item: NominationListItem): NominationRow | null {
  if (!item.congress || !item.number) return null;
  const part = item.partNumber ? Number(item.partNumber) : 0;
  const isMilitary = item.nominationType?.isMilitary === true;
  const parsed = isMilitary ? { nominee: null, position: null } : parseNominationDescription(item.description);
  return {
    id: nominationId(item.congress, item.number, part),
    congress: item.congress,
    number: item.number,
    part: part > 0 ? part : null,
    citation: item.citation ?? `PN${item.number}${part > 0 ? `-${part}` : ''}`,
    description: item.description?.replace(/\s+/g, ' ').trim() ?? null,
    nominee: parsed.nominee,
    position: parsed.position,
    organization: item.organization ?? null,
    is_military: isMilitary,
    received_date: item.receivedDate ?? null,
    latest_action_date: item.latestAction?.actionDate ?? null,
    latest_action_text: item.latestAction?.text ?? null,
    status: nominationStatus(item.latestAction?.text),
    source_updated_at: item.updateDate ? new Date(item.updateDate).toISOString() : null,
  };
}

export async function syncNominations(
  sql: Sql,
  client: CongressClient,
  congress: number,
  since: string | undefined,
): Promise<{ written: number; seen: number }> {
  let written = 0;
  let seen = 0;
  // An hour of overlap: Congress.gov stamps updateDate a little before the record is listed.
  const from = since ? new Date(Date.parse(since) - 3_600_000).toISOString() : undefined;
  for await (const item of client.listNominations(congress, { fromDateTime: from })) {
    const row = nominationRow(item);
    if (!row) continue;
    seen++;
    if (await upsertIfChanged(sql, 'public.nominations', ['id'], row)) written++;
  }
  return { written, seen };
}

/** One run: executive orders, then nominations for the current Congress. */
export async function syncExecutive(
  run: JobRun<ExecutiveCursor>,
  options: { federalRegister: FederalRegisterClient; congress: CongressClient; congressNumber: number; now?: Date },
): Promise<ExecutiveCursor> {
  const cursor: ExecutiveCursor = { ...run.cursor, nominations: { ...(run.cursor.nominations ?? {}) } };
  const startedAt = (options.now ?? new Date()).toISOString();
  try {
    const orders = await syncExecutiveOrders(run.sql, options.federalRegister, cursor.ordersPublished);
    cursor.ordersPublished = orders.newest;
    run.rowsWritten += orders.written;
    run.log('executive orders', { written: orders.written, newest: orders.newest });
    await run.checkpoint(cursor);

    const key = String(options.congressNumber);
    const noms = await syncNominations(run.sql, options.congress, options.congressNumber, cursor.nominations![key]);
    cursor.nominations![key] = startedAt;
    run.rowsWritten += noms.written;
    run.log('nominations', noms);
  } catch (error) {
    // Out of requests: keep what was saved; the next run picks up from the cursor.
    if (!(error instanceof BudgetExhaustedError)) throw error;
    run.log('executive: budget exhausted', {});
  }
  return cursor;
}
