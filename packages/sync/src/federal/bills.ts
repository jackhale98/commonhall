/**
 * Federal bill sync. One code path serves the backfill and the hourly job:
 *
 *  1. fetch the bill detail (1 request);
 *  2. compare its sub-endpoint counts with the stored ones and fetch only the
 *     sub-endpoints whose counts changed (all of them for a new bill);
 *  3. write the bill and its children in one transaction, updating rows only
 *     when a value actually changed;
 *  4. report what changed so callers can emit feed events.
 */
import {
  billId,
  congressGovBillUrl,
  deriveStatus,
  type BillAction,
  type BillDetail,
  type BillTitle,
  type CongressClient,
  type Cosponsor,
  type TextVersion,
} from '@civic/congress-client';
import { insertMany, upsertIfChanged, type AnySql, type Sql } from '../db.ts';
import { writeBillCommittees } from './committees.ts';
import { chamberFromText, htmlToText, nameFromFullName, partyCode, stateCode, toDate, toTimestamp } from '../text.ts';

export interface StoredCounts {
  actions_count: number;
  cosponsors_count: number;
  summaries_count: number;
  subjects_count: number;
  text_versions_count: number;
  titles_count: number;
  policy_area: string | null;
}

export interface ActionRow {
  bill_id: string;
  seq: number;
  action_date: string | null;
  action_time: string | null;
  text: string;
  action_code: string | null;
  action_type: string | null;
  chamber: 'house' | 'senate' | null;
  source_system: string | null;
}

export interface CosponsorRow {
  bill_id: string;
  member_id: string;
  sponsored_date: string | null;
  withdrawn_date: string | null;
  is_original: boolean;
}

export interface BillChange {
  id: string;
  congress: number;
  billType: string;
  number: number;
  /** Short title if known, else the official title. */
  title: string;
  sponsorId: string | null;
  introducedDate: string | null;
  isNew: boolean;
  billChanged: boolean;
  /** Actions present now but not before (by date + code + text). Empty for new bills' history. */
  newActions: ActionRow[];
  /** All actions, set only when the action list was re-fetched. */
  actions?: ActionRow[];
  newCosponsors: CosponsorRow[];
  statusBefore: string | null;
  statusAfter: string | null;
  rowsWritten: number;
  requests: number;
}

export function detailCounts(detail: BillDetail) {
  return {
    actions_count: detail.actions?.count ?? 0,
    cosponsors_count: detail.cosponsors?.countIncludingWithdrawnCosponsors ?? detail.cosponsors?.count ?? 0,
    summaries_count: detail.summaries?.count ?? 0,
    subjects_count: detail.subjects?.count ?? 0,
    text_versions_count: detail.textVersions?.count ?? 0,
    titles_count: detail.titles?.count ?? 0,
  };
}

export function actionKey(a: Pick<ActionRow, 'action_date' | 'action_code' | 'text'>): string {
  return `${a.action_date ?? ''}|${a.action_code ?? ''}|${a.text}`;
}

/** API order is newest first; store oldest first as seq 1..n. */
export function actionRows(id: string, actions: BillAction[]): ActionRow[] {
  return [...actions].reverse().map((a, i) => ({
    bill_id: id,
    seq: i + 1,
    action_date: toDate(a.actionDate),
    action_time: a.actionTime && /^\d{2}:\d{2}(:\d{2})?$/.test(a.actionTime) ? a.actionTime : null,
    text: (a.text ?? '').trim(),
    action_code: a.actionCode ?? null,
    action_type: a.type ?? null,
    chamber: chamberFromText(a.sourceSystem?.name),
    source_system: a.sourceSystem?.name ?? null,
  }));
}

export function cosponsorRows(id: string, cosponsors: Cosponsor[]): CosponsorRow[] {
  const rows = new Map<string, CosponsorRow>();
  for (const c of cosponsors) {
    const memberId = c.bioguideId ?? c.bioguidId;
    if (!memberId) continue;
    rows.set(memberId, {
      bill_id: id,
      member_id: memberId,
      sponsored_date: toDate(c.sponsorshipDate),
      withdrawn_date: toDate(c.sponsorshipWithdrawnDate),
      is_original: c.isOriginalCosponsor === true,
    });
  }
  return [...rows.values()];
}

/** Bump to re-pick every stored short title (see catchUpBillTitles). */
export const TITLES_REV = 1;

const SHORT_TITLE_PRIORITY = [/enacted/i, /passed|agreed/i, /reported/i, /introduced/i];

/**
 * Prefer the enacted short title, then passed, reported, introduced. Titles "for
 * portions of this bill" name one part of a large bill (H.R. 1's "FEHB Protection
 * Act of 2025"), so they are used only when nothing else exists.
 */
export function pickShortTitle(titles: BillTitle[]): string | null {
  const all = titles.filter((t) => t.title && /^short title/i.test(t.titleType ?? ''));
  const whole = all.filter((t) => !/portions?/i.test(t.titleType ?? ''));
  const short = whole.length > 0 ? whole : all;
  for (const pattern of SHORT_TITLE_PRIORITY) {
    const match = short.find((t) => pattern.test(t.titleType ?? ''));
    if (match?.title) return match.title.trim();
  }
  return short[0]?.title?.trim() ?? null;
}

/** Latest text version's HTML (or PDF) link. */
export function pickTextUrl(versions: TextVersion[]): string | null {
  const sorted = [...versions].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  for (const version of sorted) {
    const formats = version.formats ?? [];
    const html = formats.find((f) => /formatted text/i.test(f.type ?? ''));
    const pdf = formats.find((f) => /pdf/i.test(f.type ?? ''));
    const url = html?.url ?? pdf?.url ?? formats[0]?.url;
    if (url) return url;
  }
  return null;
}

/** Ensure a member row exists for a sponsor/cosponsor we may not have synced yet. */
async function ensureMemberStub(
  sql: AnySql,
  m: {
    bioguideId?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    party?: string;
    state?: string;
    district?: number;
  },
): Promise<number> {
  if (!m.bioguideId) return 0;
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || nameFromFullName(m.fullName) || m.bioguideId;
  const result = await sql`
    insert into public.members (bioguide_id, name, first_name, last_name, party, state, district, current)
    values (${m.bioguideId}, ${name}, ${m.firstName ?? null}, ${m.lastName ?? null}, ${partyCode(m.party)},
            ${stateCode(m.state)}, ${m.district ?? null}, false)
    on conflict (bioguide_id) do nothing
    returning 1`;
  return result.length;
}

export interface SyncBillOptions {
  /** Re-fetch every sub-endpoint regardless of counts. */
  force?: boolean;
}

/**
 * Sync one bill. Network calls happen first; all writes happen in a single
 * transaction afterwards, so a crash leaves either the old or the new state.
 */
export async function syncBill(
  sql: Sql,
  client: CongressClient,
  congress: number,
  type: string,
  number: number | string,
  options: SyncBillOptions = {},
): Promise<BillChange> {
  const startRequests = client.budget.used;
  const id = billId(congress, type, number);
  const detail = await client.getBill(congress, type, number);
  const counts = detailCounts(detail);

  const [stored] = await sql<(StoredCounts & { status: string; short_title: string | null })[]>`
    select actions_count, cosponsors_count, summaries_count, subjects_count, text_versions_count,
           titles_count, policy_area, status, short_title
      from public.bills where id = ${id}`;
  const isNew = !stored;
  const changed = (key: keyof typeof counts) => options.force || isNew || stored![key] !== counts[key];

  const t = type.toLowerCase();
  const fetchActions = changed('actions_count');
  const fetchCosponsors = changed('cosponsors_count') && (counts.cosponsors_count > 0 || !isNew);
  const fetchSubjects =
    (changed('subjects_count') || (stored && stored.policy_area !== (detail.policyArea?.name ?? null))) &&
    (counts.subjects_count > 0 || !isNew);
  const fetchSummaries = changed('summaries_count') && counts.summaries_count > 0;
  const fetchText = changed('text_versions_count') && counts.text_versions_count > 0;
  const fetchTitles = changed('titles_count') && counts.titles_count > 0;

  const actions = fetchActions ? await client.getBillActions(congress, t, number) : undefined;
  const cosponsors = fetchCosponsors ? await client.getBillCosponsors(congress, t, number) : undefined;
  const subjects = fetchSubjects ? await client.getBillSubjects(congress, t, number) : undefined;
  const summaries = fetchSummaries ? await client.getBillSummaries(congress, t, number) : undefined;
  const textVersions = fetchText ? await client.getBillText(congress, t, number) : undefined;
  const titles = fetchTitles ? await client.getBillTitles(congress, t, number) : undefined;

  const row: Record<string, unknown> = {
    id,
    congress,
    bill_type: t,
    number: Number(number),
    origin_chamber: chamberFromText(detail.originChamber),
    title: detail.title?.trim() || id,
    introduced_date: toDate(detail.introducedDate),
    sponsor_id: detail.sponsors?.[0]?.bioguideId ?? null,
    policy_area: detail.policyArea?.name ?? null,
    latest_action_date: toDate(detail.latestAction?.actionDate),
    latest_action_text: detail.latestAction?.text?.trim() ?? null,
    congress_gov_url: detail.legislationUrl ?? congressGovBillUrl(congress, t, number),
    law_number: detail.laws?.[0]?.number ?? null,
    update_date: toTimestamp(detail.updateDate),
    update_date_including_text: toTimestamp(detail.updateDateIncludingText),
    ...counts,
  };

  let actionList: ActionRow[] | undefined;
  if (actions) {
    actionList = actionRows(id, actions);
    row.status = deriveStatus(t, actions);
  }
  if (summaries) {
    const latest = [...summaries].sort((a, b) =>
      `${b.actionDate ?? ''}${b.updateDate ?? ''}`.localeCompare(`${a.actionDate ?? ''}${a.updateDate ?? ''}`),
    )[0];
    row.summary_text = htmlToText(latest?.text);
  } else if (counts.summaries_count === 0) {
    row.summary_text = null;
  }
  if (textVersions) row.text_url = pickTextUrl(textVersions);
  if (titles) {
    row.short_title = pickShortTitle(titles);
    row.titles_rev = TITLES_REV;
  }
  if (subjects?.policyArea?.name) row.policy_area = subjects.policyArea.name;

  const change: BillChange = {
    id,
    congress,
    billType: t,
    number: Number(number),
    title: (row.short_title as string | null | undefined) ?? stored?.short_title ?? (row.title as string),
    sponsorId: (row.sponsor_id as string | null) ?? null,
    introducedDate: (row.introduced_date as string | null) ?? null,
    isNew,
    billChanged: false,
    newActions: [],
    actions: actionList,
    newCosponsors: [],
    statusBefore: stored?.status ?? null,
    statusAfter: (row.status as string | undefined) ?? stored?.status ?? 'introduced',
    rowsWritten: 0,
    requests: 0,
  };

  await sql.begin(async (tx) => {
    let written = 0;
    for (const sponsor of detail.sponsors ?? []) written += await ensureMemberStub(tx, sponsor);
    if (await upsertIfChanged(tx, 'public.bills', ['id'], row)) {
      written += 1;
      change.billChanged = true;
    }

    if (actionList) {
      const previous = await tx<{ action_date: string | null; action_code: string | null; text: string }[]>`
        select to_char(action_date, 'YYYY-MM-DD') as action_date, action_code, text
          from public.bill_actions where bill_id = ${id}`;
      const before = new Set(previous.map(actionKey));
      const after = actionList.map(actionKey);
      const same = previous.length === actionList.length && after.every((k) => before.has(k));
      if (!same) {
        change.newActions = isNew ? [] : actionList.filter((a) => !before.has(actionKey(a)));
        await tx`delete from public.bill_actions where bill_id = ${id}`;
        written += await insertMany(tx, 'public.bill_actions', actionList as unknown as Record<string, unknown>[]);
      }
      // The committees each action names: referrals, reports, hearings and markups.
      written += await writeBillCommittees(tx, id, actions!);
    }

    if (cosponsors) {
      const rows = cosponsorRows(id, cosponsors);
      for (const c of cosponsors) {
        written += await ensureMemberStub(tx, { ...c, bioguideId: c.bioguideId ?? c.bioguidId });
      }
      const previous = await tx<
        { member_id: string }[]
      >`select member_id from public.bill_cosponsors where bill_id = ${id}`;
      const before = new Set(previous.map((p) => p.member_id));
      if (!isNew) change.newCosponsors = rows.filter((r) => !before.has(r.member_id) && !r.withdrawn_date);
      for (const r of rows) {
        if (
          await upsertIfChanged(
            tx,
            'public.bill_cosponsors',
            ['bill_id', 'member_id'],
            r as unknown as Record<string, unknown>,
          )
        ) {
          written += 1;
        }
      }
      const keep = rows.map((r) => r.member_id);
      const removed = await tx`
        delete from public.bill_cosponsors where bill_id = ${id} and member_id <> all(${keep}::text[]) returning 1`;
      written += removed.length;
    }

    if (subjects) {
      const names = [
        ...new Set((subjects.legislativeSubjects ?? []).map((s) => s.name?.trim()).filter(Boolean)),
      ] as string[];
      const previous = await tx<{ subject: string }[]>`select subject from public.bill_subjects where bill_id = ${id}`;
      const before = new Set(previous.map((p) => p.subject));
      const toAdd = names.filter((n) => !before.has(n));
      const toRemove = [...before].filter((n) => !names.includes(n));
      if (toRemove.length > 0) {
        const removed = await tx`
          delete from public.bill_subjects where bill_id = ${id} and subject = any(${toRemove}::text[]) returning 1`;
        written += removed.length;
      }
      written += await insertMany(
        tx,
        'public.bill_subjects',
        toAdd.map((subject) => ({ bill_id: id, subject })),
        true,
      );
    }

    change.rowsWritten = written;
  });

  change.requests = client.budget.used - startRequests;
  return change;
}

/** Bills whose short title was picked by an older rule: fetch their titles again, most recently active first. */
export async function catchUpBillTitles(
  sql: Sql,
  client: CongressClient,
  limit: number,
  outOfTime: () => boolean,
): Promise<{ checked: number; changed: number }> {
  const due = await sql<
    { id: string; congress: number; bill_type: string; number: number; short_title: string | null }[]
  >`
    select id, congress, bill_type, number, short_title from public.bills
     where titles_rev < ${TITLES_REV} and titles_count > 0
     order by latest_action_date desc nulls last, id
     limit ${limit}`;
  let checked = 0;
  let changed = 0;
  for (const b of due) {
    if (outOfTime() || client.budget.remaining < 2) break;
    const short = pickShortTitle(await client.getBillTitles(b.congress, b.bill_type, b.number));
    await sql`update public.bills set short_title = ${short}, titles_rev = ${TITLES_REV} where id = ${b.id}`;
    if (short !== b.short_title) changed++;
    checked++;
  }
  return { checked, changed };
}
