/**
 * Fetch a bill or member that is not in the database (older Congresses, or a
 * bill not yet synced), shape it like our own rows, and cache it in
 * `archive_cache`. Used by the public fetch-on-demand function, so every call is
 * bounded: a fixed number of requests per item and an hourly cap overall.
 */
import {
  billId,
  congressForDate,
  congressGovBillUrl,
  deriveStatus,
  parseBillId,
  type CongressClient,
  type MemberDetail,
} from '@civic/congress-client';
import type { Sql } from '../db.ts';
import { directOrder, htmlToText, nameFromFullName, partyCode, stateCode, toDate } from '../text.ts';
import { actionRows, cosponsorRows, pickTextUrl } from './bills.ts';

export const ON_DEMAND_API = 'congress-ondemand';
/** Upstream requests per hour that anonymous visitors can trigger in total. */
export const ON_DEMAND_HOURLY_CAP = 300;

export interface OnDemandMember {
  bioguide_id: string;
  name: string;
  party: string | null;
  state: string | null;
  district: number | null;
  chamber: 'house' | 'senate' | null;
}

export interface BillPayload {
  kind: 'bill';
  bill: Record<string, unknown>;
  sponsor: OnDemandMember | null;
  actions: ReturnType<typeof actionRows>;
  cosponsors: (ReturnType<typeof cosponsorRows>[number] & { member: OnDemandMember })[];
  subjects: string[];
}

export interface MemberPayload {
  kind: 'member';
  member: Record<string, unknown>;
  sponsored: Record<string, unknown>[];
}

export type Payload = BillPayload | MemberPayload;

export class OnDemandError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OnDemandError';
  }
}

export function cacheKey(kind: 'bill' | 'member', id: string): string {
  return `${kind}:${id}`;
}

export function validateRequest(kind: unknown, id: unknown): { kind: 'bill' | 'member'; id: string } {
  if (kind === 'bill' && typeof id === 'string') {
    const ref = parseBillId(id);
    if (!ref || ref.congress < 93 || ref.congress > congressForDate(new Date())) {
      throw new OnDemandError(400, 'Unknown bill id');
    }
    return { kind, id: billId(ref.congress, ref.type, ref.number) };
  }
  if (kind === 'member' && typeof id === 'string' && /^[A-Z]\d{6}$/.test(id)) return { kind, id };
  throw new OnDemandError(400, 'Expected {"kind":"bill","id":"118-hr-1"} or {"kind":"member","id":"A000375"}');
}

function memberFromRef(m: {
  bioguideId?: string;
  bioguidId?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  party?: string;
  state?: string;
  district?: number;
}): OnDemandMember | null {
  const id = m.bioguideId ?? m.bioguidId;
  if (!id) return null;
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || nameFromFullName(m.fullName) || id;
  const chamber = /^Sen\./.test(m.fullName ?? '') ? 'senate' : m.district !== undefined ? 'house' : null;
  return {
    bioguide_id: id,
    name,
    party: partyCode(m.party),
    state: stateCode(m.state),
    district: chamber === 'house' ? (m.district ?? 0) : null,
    chamber,
  };
}

export async function fetchBillPayload(client: CongressClient, id: string): Promise<BillPayload> {
  const ref = parseBillId(id)!;
  const detail = await client.getBill(ref.congress, ref.type, ref.number);
  const [actions, cosponsors, subjects, summaries, text] = await Promise.all([
    (detail.actions?.count ?? 0) > 0 ? client.getBillActions(ref.congress, ref.type, ref.number) : [],
    (detail.cosponsors?.count ?? 0) > 0
      ? client.get<{ cosponsors?: Parameters<typeof cosponsorRows>[1] }>(
          `/bill/${ref.congress}/${ref.type}/${ref.number}/cosponsors`,
          { limit: 250 },
        )
      : { cosponsors: [] },
    (detail.subjects?.count ?? 0) > 0
      ? client.get<{ subjects?: { legislativeSubjects?: { name?: string }[] } }>(
          `/bill/${ref.congress}/${ref.type}/${ref.number}/subjects`,
          { limit: 250 },
        )
      : { subjects: { legislativeSubjects: [] } },
    (detail.summaries?.count ?? 0) > 0 ? client.getBillSummaries(ref.congress, ref.type, ref.number) : [],
    (detail.textVersions?.count ?? 0) > 0 ? client.getBillText(ref.congress, ref.type, ref.number) : [],
  ]);
  const rawCosponsors = cosponsors.cosponsors ?? [];
  const latestSummary = [...summaries].sort((a, b) =>
    `${b.actionDate ?? ''}${b.updateDate ?? ''}`.localeCompare(`${a.actionDate ?? ''}${a.updateDate ?? ''}`),
  )[0];
  const rows = cosponsorRows(id, rawCosponsors);
  const memberById = new Map(rawCosponsors.map((c) => [c.bioguideId ?? c.bioguidId, memberFromRef(c)]));

  return {
    kind: 'bill',
    bill: {
      id,
      congress: ref.congress,
      bill_type: ref.type,
      number: ref.number,
      origin_chamber: /house/i.test(detail.originChamber ?? '') ? 'house' : 'senate',
      title: detail.title ?? id,
      short_title: null,
      introduced_date: toDate(detail.introducedDate),
      sponsor_id: detail.sponsors?.[0]?.bioguideId ?? null,
      policy_area: detail.policyArea?.name ?? null,
      latest_action_date: toDate(detail.latestAction?.actionDate),
      latest_action_text: detail.latestAction?.text ?? null,
      status: deriveStatus(ref.type, actions),
      summary_text: htmlToText(latestSummary?.text),
      text_url: pickTextUrl(text),
      congress_gov_url: detail.legislationUrl ?? congressGovBillUrl(ref.congress, ref.type, ref.number),
      law_number: detail.laws?.[0]?.number ?? null,
      cosponsors_count: rows.filter((r) => !r.withdrawn_date).length,
    },
    sponsor: detail.sponsors?.[0] ? memberFromRef(detail.sponsors[0]) : null,
    actions: actionRows(id, actions),
    cosponsors: rows.map((r) => ({ ...r, member: memberById.get(r.member_id)! })).filter((r) => r.member),
    subjects: (subjects.subjects?.legislativeSubjects ?? []).map((s) => s.name ?? '').filter(Boolean),
  };
}

function memberRow(m: MemberDetail) {
  const terms = m.terms ?? [];
  const last = terms[terms.length - 1];
  const chamber = last?.chamber ? (/senate/i.test(last.chamber) ? 'senate' : 'house') : null;
  const party = m.partyHistory?.[m.partyHistory.length - 1]?.partyAbbreviation ?? null;
  return {
    bioguide_id: m.bioguideId,
    name: m.directOrderName ?? directOrder(m.invertedOrderName) ?? m.bioguideId,
    party: partyCode(party),
    party_name: m.partyHistory?.[m.partyHistory.length - 1]?.partyName ?? null,
    state: last?.stateCode ?? stateCode(m.state),
    district: chamber === 'house' ? (last?.district ?? m.district ?? 0) : null,
    chamber,
    current: m.currentMember === true,
    photo_url: m.depiction?.imageUrl ?? null,
    website: m.officialWebsiteUrl ?? null,
    phone: m.addressInformation?.phoneNumber ?? null,
    office: m.addressInformation?.officeAddress ?? null,
    contact_form: null,
    social: {},
    terms: terms.map((t) => ({
      chamber: t.chamber,
      congress: t.congress,
      start: t.startYear,
      end: t.endYear ?? null,
      state: t.stateCode,
      district: t.district ?? null,
    })),
  };
}

export async function fetchMemberPayload(client: CongressClient, id: string): Promise<MemberPayload> {
  const [member, sponsored] = await Promise.all([client.getMember(id), client.getSponsoredLegislation(id, 20)]);
  return {
    kind: 'member',
    member: memberRow(member),
    sponsored: sponsored
      .filter((s) => s.type && s.number && s.congress)
      .map((s) => ({
        id: billId(s.congress!, s.type!, s.number!),
        congress: s.congress,
        bill_type: s.type!.toLowerCase(),
        number: Number(s.number),
        title: s.title ?? '',
        short_title: null,
        introduced_date: toDate(s.introducedDate),
        latest_action_date: toDate(s.latestAction?.actionDate),
        latest_action_text: s.latestAction?.text ?? null,
        status: deriveStatus(s.type!.toLowerCase(), s.latestAction ? [s.latestAction] : []),
        sponsor_id: id,
        policy_area: s.policyArea?.name ?? null,
      })),
  };
}

/**
 * Serve from cache when fresh; otherwise fetch (if the hourly cap allows), cache
 * and return. Past Congresses are cached for 30 days, anything else for 1 hour.
 */
export async function getOnDemand(
  sql: Sql,
  makeClient: (requestCap: number) => CongressClient,
  kind: 'bill' | 'member',
  id: string,
): Promise<{ payload: Payload; cached: boolean }> {
  const key = cacheKey(kind, id);
  const [hit] = await sql<{ payload: Payload }[]>`
    select payload from public.archive_cache where key = ${key} and expires_at > now()`;
  if (hit) return { payload: hit.payload, cached: true };

  const [usage] = await sql<{ used: number }[]>`select public.api_usage_this_hour(${ON_DEMAND_API}) as used`;
  const remaining = ON_DEMAND_HOURLY_CAP - (usage?.used ?? 0);
  if (remaining < 8) throw new OnDemandError(429, 'Too many archive lookups this hour; try again later.');

  const client = makeClient(Math.min(remaining, 12));
  try {
    const payload = kind === 'bill' ? await fetchBillPayload(client, id) : await fetchMemberPayload(client, id);
    const current = congressForDate(new Date());
    const congress = kind === 'bill' ? parseBillId(id)!.congress : current;
    const ttl = kind === 'bill' && congress < current ? '30 days' : '1 hour';
    await sql`
      insert into public.archive_cache (key, payload, fetched_at, expires_at)
      values (${key}, ${sql.json(payload as never)}, now(), now() + ${ttl}::interval)
      on conflict (key) do update set payload = excluded.payload, fetched_at = now(), expires_at = excluded.expires_at`;
    return { payload, cached: false };
  } finally {
    if (client.budget.used > 0) await sql`select public.record_api_usage(${ON_DEMAND_API}, ${client.budget.used})`;
    if (client.budget.used > 0) await sql`select public.record_api_usage('congress', ${client.budget.used})`;
  }
}
