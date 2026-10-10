/**
 * State legislators' contact details and state committees from Open States' people
 * repository (github.com/openstates/people, CC0): one YAML file per legislator under
 * data/{state}/legislature and one per committee under data/{state}/committees. The
 * "Load state people and committees" workflow downloads the repository weekly, parses
 * the files (scripts/load-state-people.ts) and hands them here. It uses none of the
 * Open States API allowance, which the state bill sync needs.
 *
 * The API sync stays the source for who a legislator is (name, party, seat); this
 * load adds offices and links, fills a missing email or photo, adds legislators the
 * API sync hasn't reached yet, and replaces each state's committees.
 */
import type { Sql } from '../db.ts';

/** A legislator file, as far as we use it. */
export interface PeoplePerson {
  id: string;
  name: string;
  email?: string;
  image?: string;
  party?: { name: string; start_date?: string; end_date?: string }[];
  roles?: { type: string; district?: string | number; start_date?: string; end_date?: string; jurisdiction?: string }[];
  offices?: { classification?: string; address?: string; voice?: string; fax?: string }[];
  links?: { url: string; note?: string }[];
}

/** A committee file, as far as we use it. */
export interface PeopleCommittee {
  id: string;
  name: string;
  chamber?: string;
  classification?: string;
  parent?: string;
  links?: { url: string }[];
  sources?: { url: string }[];
  members?: { name: string; role?: string; person_id?: string }[];
}

const CHAMBERS = new Set(['upper', 'lower', 'legislature']);
const current = (r: { end_date?: string }, today: string) => !r.end_date || r.end_date >= today;

/** Links once each: the repository lists some pages under several spellings. */
function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw.trim();
    let key: string;
    try {
      key = decodeURI(url).replace(/\s+/g, ' ').replace(/\/$/, '').toLowerCase();
    } catch {
      key = url.toLowerCase();
    }
    if (!url || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export function peopleLegislatorRow(p: PeoplePerson, state: string, today: string): Record<string, unknown> | null {
  if (!p.id?.startsWith('ocd-person/') || !p.name) return null;
  const role = (p.roles ?? []).find((r) => CHAMBERS.has(r.type) && current(r, today));
  if (!role) return null;
  const party = (p.party ?? []).find((x) => current(x, today)) ?? p.party?.[0];
  return {
    id: p.id,
    name: p.name,
    party: party?.name ?? null,
    state,
    chamber: role.type,
    district: role.district !== undefined && role.district !== null ? String(role.district) : null,
    photo_url: p.image || null,
    email: p.email || null,
    offices: (p.offices ?? [])
      .filter((o) => o.address || o.voice)
      .map((o) => ({
        classification: o.classification ?? null,
        address: o.address ?? null,
        voice: o.voice ?? null,
        fax: o.fax ?? null,
      })),
    links: uniqueUrls((p.links ?? []).map((l) => l.url)).slice(0, 6),
  };
}

export function peopleCommitteeRows(
  c: PeopleCommittee,
  state: string,
): { committee: Record<string, unknown>; members: Record<string, unknown>[] } | null {
  if (!c.id?.startsWith('ocd-organization/') || !c.name) return null;
  const members = (c.members ?? [])
    .filter((m) => m.name)
    .map((m, i) => ({
      committee_id: c.id,
      seq: i,
      person_id: m.person_id?.startsWith('ocd-person/') ? m.person_id : null,
      name: m.name,
      role: m.role ?? null,
    }));
  return {
    committee: {
      id: c.id,
      state,
      name: c.name,
      chamber: c.chamber && CHAMBERS.has(c.chamber) ? c.chamber : null,
      classification: c.classification === 'subcommittee' ? 'subcommittee' : 'committee',
      parent_id: c.parent ?? null,
      url: c.links?.[0]?.url ?? c.sources?.[0]?.url ?? null,
      member_count: members.length,
    },
    members,
  };
}

export interface PeopleLoadResult {
  legislatorsUpdated: number;
  legislatorsAdded: number;
  legislatorsRetired: number;
  committees: number;
  members: number;
}

/**
 * Write one state's people and committees in a single transaction. Legislators the
 * API sync already holds get offices and links (and an email or photo if theirs is
 * missing); others are added as current. The state's committees are replaced.
 */
export async function writeStatePeople(
  sql: Sql,
  state: string,
  people: PeoplePerson[],
  committees: PeopleCommittee[],
  today = new Date().toISOString().slice(0, 10),
): Promise<PeopleLoadResult> {
  const rows = people.map((p) => peopleLegislatorRow(p, state, today)).filter((r) => r !== null);
  const groups = committees.map((c) => peopleCommitteeRows(c, state)).filter((g) => g !== null);
  const result: PeopleLoadResult = {
    legislatorsUpdated: 0,
    legislatorsAdded: 0,
    legislatorsRetired: 0,
    committees: 0,
    members: 0,
  };
  await sql.begin(async (tx) => {
    for (const r of rows) {
      const [hit] = await tx<{ inserted: boolean }[]>`
        insert into public.state_legislators
          (id, name, party, state, chamber, district, photo_url, email, offices, links, current, people_synced_at)
        values (${r.id as string}, ${r.name as string}, ${r.party as string | null}, ${state},
                ${r.chamber as string}, ${r.district as string | null}, ${r.photo_url as string | null},
                ${r.email as string | null}, ${tx.json(r.offices as never)}, ${tx.json(r.links as never)},
                true, now())
        on conflict (id) do update set
          offices = excluded.offices,
          links = excluded.links,
          email = coalesce(public.state_legislators.email, excluded.email),
          photo_url = coalesce(public.state_legislators.photo_url, excluded.photo_url),
          people_synced_at = now()
        returning (xmax = 0) as inserted`;
      if (hit?.inserted) result.legislatorsAdded++;
      else result.legislatorsUpdated++;
    }
    // Legislators no longer serving moved to the repository's retired folder. Only trust
    // the list when it looks complete, so a partial download can't empty a state.
    if (rows.length > 20) {
      const retired = await tx`
        update public.state_legislators set current = false
         where state = ${state} and current and id <> all(${rows.map((r) => r.id as string)}::text[])
         returning 1`;
      result.legislatorsRetired = retired.length;
    }
    const ids = groups.map((g) => g.committee.id as string);
    await tx`delete from public.state_committees where state = ${state} and id <> all(${ids}::text[])`;
    for (const g of groups) {
      await tx`
        insert into public.state_committees ${tx(g.committee as never)}
        on conflict (id) do update set
          state = excluded.state, name = excluded.name, chamber = excluded.chamber,
          classification = excluded.classification, parent_id = excluded.parent_id, url = excluded.url,
          member_count = excluded.member_count, synced_at = now()`;
      await tx`delete from public.state_committee_members where committee_id = ${g.committee.id as string}`;
      if (g.members.length) await tx`insert into public.state_committee_members ${tx(g.members as never)}`;
      result.committees++;
      result.members += g.members.length;
    }
  });
  return result;
}
