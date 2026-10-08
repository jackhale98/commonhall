/**
 * Member sync (daily). Combines:
 *  - Congress.gov `/member/congress/{congress}`: everyone who served this Congress
 *    (name, party, state, district, photo), and `currentMember=true` for who sits now;
 *  - congress-legislators: LIS IDs (for Senate votes), website, phone, office,
 *    contact form and social accounts.
 * Rows are only rewritten when a value changed.
 */
import {
  summarizeLegislator,
  type CongressClient,
  type LegislatorSocial,
  type LegislatorsClient,
  type MemberListItem,
} from '@civic/congress-client';
import { upsertIfChanged, type Sql } from '../db.ts';
import { directOrder, partyCode, stateCode, toTimestamp } from '../text.ts';

export interface MemberRow extends Record<string, unknown> {
  bioguide_id: string;
  name: string;
  sort_name: string | null;
  first_name: string | null;
  last_name: string | null;
  party: string | null;
  party_name: string | null;
  state: string | null;
  district: number | null;
  chamber: 'house' | 'senate' | null;
  current: boolean;
  photo_url: string | null;
  lis_id: string | null;
  website: string | null;
  phone: string | null;
  office: string | null;
  contact_form: string | null;
  social: Record<string, string>;
  updated_at: string;
}

export function memberChamber(item: MemberListItem): 'house' | 'senate' | null {
  const terms = item.terms?.item ?? [];
  const last = terms[terms.length - 1];
  if (!last?.chamber) return null;
  return /senate/i.test(last.chamber) ? 'senate' : 'house';
}

function socialLinks(entry: LegislatorSocial | undefined): Record<string, string> {
  if (!entry) return {};
  const s = entry.social;
  const out: Record<string, string> = {};
  if (s.twitter) out.twitter = `https://x.com/${s.twitter}`;
  if (s.facebook) out.facebook = `https://www.facebook.com/${s.facebook}`;
  if (s.youtube_id) out.youtube = `https://www.youtube.com/channel/${s.youtube_id}`;
  else if (s.youtube) out.youtube = `https://www.youtube.com/${s.youtube}`;
  if (s.instagram) out.instagram = `https://www.instagram.com/${s.instagram}`;
  if (s.bluesky) out.bluesky = `https://bsky.app/profile/${s.bluesky}`;
  if (s.mastodon?.startsWith('https://')) out.mastodon = s.mastodon;
  return out;
}

export function buildMemberRows(
  items: MemberListItem[],
  currentIds: Set<string>,
  legislators: ReturnType<typeof summarizeLegislator>[],
  social: LegislatorSocial[],
): MemberRow[] {
  const legById = new Map(legislators.filter(Boolean).map((l) => [l!.bioguideId, l!]));
  const socialById = new Map(social.map((s) => [s.id.bioguide, s]));
  const rows: MemberRow[] = [];
  for (const item of items) {
    const id = item.bioguideId;
    if (!id) continue;
    const leg = legById.get(id);
    const chamber = memberChamber(item) ?? leg?.chamber ?? null;
    const inverted = item.name ?? null;
    const [last, first] = inverted?.includes(',') ? inverted.split(',').map((s) => s.trim()) : [null, null];
    const party = partyCode(item.partyName ?? leg?.party);
    rows.push({
      bioguide_id: id,
      name: leg?.name ?? directOrder(inverted) ?? id,
      sort_name: inverted,
      first_name: first ?? null,
      last_name: last ?? null,
      party,
      party_name: item.partyName ?? null,
      state: stateCode(item.state) ?? leg?.state ?? null,
      district: chamber === 'house' ? (item.district ?? leg?.district ?? 0) : null,
      chamber,
      current: currentIds.has(id),
      photo_url: item.depiction?.imageUrl ?? null,
      lis_id: leg?.lisId ?? null,
      website: leg?.website ?? null,
      phone: leg?.phone ?? null,
      office: leg?.office ?? null,
      contact_form: leg?.contactForm ?? null,
      social: socialLinks(socialById.get(id)),
      updated_at: toTimestamp(item.updateDate) ?? new Date(0).toISOString(),
    });
  }
  return rows;
}

export interface SyncMembersOptions {
  congress: number;
  client: CongressClient;
  legislators: LegislatorsClient;
}

export async function syncMembers(
  sql: Sql,
  options: SyncMembersOptions,
): Promise<{ rowsWritten: number; members: number }> {
  const { client, congress } = options;
  const all: MemberListItem[] = [];
  for await (const m of client.listMembers(congress)) all.push(m);
  const currentIds = new Set<string>();
  for await (const m of client.listMembers(congress, { currentMember: true })) {
    if (m.bioguideId) currentIds.add(m.bioguideId);
  }
  if (currentIds.size === 0)
    throw new Error('Congress.gov returned no current members; refusing to mark everyone former');

  const [legislators, social] = await Promise.all([options.legislators.current(), options.legislators.social()]);
  const summaries = legislators.map(summarizeLegislator);
  const rows = buildMemberRows(all, currentIds, summaries, social);
  let written = 0;
  await sql.begin(async (tx) => {
    // LIS IDs are unique; clear any that moved to a different member first.
    const lisOwners = new Map(rows.filter((r) => r.lis_id).map((r) => [r.lis_id!, r.bioguide_id]));
    for (const [lis, owner] of lisOwners) {
      const cleared = await tx`
        update public.members set lis_id = null where lis_id = ${lis} and bioguide_id <> ${owner} returning 1`;
      written += cleared.length;
    }
    for (const row of rows) {
      if (await upsertIfChanged(tx, 'public.members', ['bioguide_id'], row)) written += 1;
    }
    const retired = await tx`
      update public.members set current = false
       where current and bioguide_id <> all(${[...currentIds]}::text[])
       returning 1`;
    written += retired.length;
  });

  return { rowsWritten: written, members: rows.length };
}
