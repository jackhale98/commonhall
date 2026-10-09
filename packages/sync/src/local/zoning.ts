/**
 * Boston Zoning Board of Appeal cases from Analyze Boston
 * ("zoning-board-of-appeal-tracker"). The city's table holds every appeal since
 * the 1990s; a daily run asks it (in SQL, on the city's side) for the ones that are
 * still open or were heard in the last year — about 1,200 — and writes what
 * changed. Applicants' names ("contact") are deliberately not read.
 */
import { datastoreResource, type AnalyzeBostonClient } from '@civic/congress-client';
import { upsertIfChanged } from '../db.ts';
import type { JobRun } from '../job.ts';

export const ZBA_JOB = 'boston-zba';
export const ZBA_DATASET = 'zoning-board-of-appeal-tracker';

export interface ZbaCursor {
  [key: string]: unknown;
  lastCount?: number;
}

export interface ZbaAppealRow extends Record<string, unknown> {
  boa_apno: string;
  parent_apno: string | null;
  address: string | null;
  neighborhood: string | null;
  zip: string | null;
  ward: string | null;
  zoning_district: string | null;
  appeal_type: string | null;
  status: string | null;
  description: string | null;
  received_date: string | null;
  hearing_date: string | null;
  decision: string | null;
  final_decision_date: string | null;
  closed_date: string | null;
  deferrals: number;
}

const DECISIONS: Record<string, string> = {
  approved: 'Approved',
  appprov: 'Approved with provisos',
  denied: 'Denied',
  deniedprej: 'Denied',
  withdrawn: 'Withdrawn',
  withdraw: 'Withdrawn',
  void: 'Void',
};

/** The city's decision codes in plain words (unknown codes are kept as they are). */
export function zbaDecision(code: unknown): string | null {
  const s = String(code ?? '').trim();
  if (!s) return null;
  return DECISIONS[s.toLowerCase()] ?? s;
}

/** A YYYY-MM-DD date, or null for empty and placeholder dates (the table has some from 1753). */
export function zbaDate(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  return m && Number(m[1]) >= 1990 ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const text = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

export function zbaAppealRow(r: Record<string, unknown>): ZbaAppealRow | null {
  const id = text(r.boa_apno);
  if (!id) return null;
  return {
    boa_apno: id,
    parent_apno: text(r.parent_apno),
    address: text(r.address),
    neighborhood: text(r.city),
    zip: text(r.zip),
    ward: text(r.ward),
    zoning_district: text(r.zoning_district),
    appeal_type: text(r.appeal_type),
    status: text(r.status),
    description: text(r.project_description),
    received_date: zbaDate(r.received_date),
    hearing_date: zbaDate(r.hearing_date),
    decision: zbaDecision(r.decision),
    final_decision_date: zbaDate(r.final_decision_date),
    closed_date: zbaDate(r.closed_date),
    deferrals: Number(r.num_deferrals) || 0,
  };
}

/** The columns read (not "contact", the applicant's name). */
const COLUMNS = [
  'boa_apno',
  'parent_apno',
  'address',
  'city',
  'zip',
  'ward',
  'zoning_district',
  'appeal_type',
  'status',
  'project_description',
  'received_date',
  'hearing_date',
  'decision',
  'final_decision_date',
  'closed_date',
  'num_deferrals',
];

export async function syncZoningAppeals(
  run: JobRun<ZbaCursor>,
  options: { client: AnalyzeBostonClient; now?: () => Date },
): Promise<ZbaCursor> {
  const resource = datastoreResource(await options.client.packageShow(ZBA_DATASET));
  if (!resource) throw new Error('Zoning Board of Appeal: no datastore table in the dataset');
  const since = new Date((options.now?.() ?? new Date()).getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  const records = await options.client.sql<Record<string, unknown>>(
    `SELECT ${COLUMNS.map((c) => `"${c}"`).join(', ')} FROM "${resource.id}"
      WHERE hearing_date >= '${since}' OR status <> 'Appeal Closed'`,
  );
  // The city's table repeats some case numbers (a rescheduled hearing is a new row): keep the latest.
  const byId = new Map<string, ZbaAppealRow>();
  for (const row of records.map(zbaAppealRow)) {
    if (!row) continue;
    const seen = byId.get(row.boa_apno);
    const key = (r: ZbaAppealRow) => `${r.hearing_date ?? ''}|${r.final_decision_date ?? ''}|${r.closed_date ?? ''}`;
    if (!seen || key(row) >= key(seen)) byId.set(row.boa_apno, row);
  }
  const rows = [...byId.values()];
  if (rows.length === 0) throw new Error('Zoning Board of Appeal: no rows came back; keeping the stored cases');
  for (const row of rows) {
    if (await upsertIfChanged(run.sql, 'public.zba_appeals', ['boa_apno'], row)) run.rowsWritten++;
  }
  // Cases that left the window (closed and heard over a year ago).
  const gone = await run.sql`
    delete from public.zba_appeals where boa_apno <> all(${rows.map((r) => r.boa_apno)}::text[]) returning 1`;
  run.rowsWritten += gone.length;
  run.log('boston-zba', { cases: rows.length, written: run.rowsWritten });
  return { lastCount: rows.length };
}
