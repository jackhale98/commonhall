/**
 * Members insights: party unity rankings and campaign-money leaderboards, computed at
 * build time from data the site already loads.
 */
import type { MemberFinance } from './finance';
import { partyLetter } from './format';
import type { Member } from './types';

/** A row of member_party_unity: party-line roll calls (most D vs most R) and votes with the party. */
export interface UnityRow {
  member_id: string;
  congress: number;
  chamber: 'house' | 'senate';
  party: 'D' | 'R';
  party_votes: number;
  with_party: number;
}

export interface UnityEntry {
  id: string;
  name: string;
  state: string | null;
  district: number | null;
  /** Share of party-line votes cast with the party's majority, 0–1. */
  share: number;
  with: number;
  of: number;
}

export interface UnityBoard {
  most: UnityEntry[];
  least: UnityEntry[];
  /** Median share across the party's ranked members. */
  median: number | null;
  /** Members ranked (enough party-line votes). */
  ranked: number;
  /** Party-line votes in the chamber (the most any member voted on). */
  partyLineVotes: number;
}

/**
 * The members of one party in one chamber who voted with their party most and least
 * often. Only current members who voted on at least `minShare` of the chamber's
 * party-line votes are ranked, so a member who joined late or missed most votes
 * isn't ranked on a handful.
 */
export function unityBoard(
  rows: UnityRow[],
  members: Map<string, Member>,
  chamber: 'house' | 'senate',
  party: 'D' | 'R',
  { n = 5, minShare = 0.5 } = {},
): UnityBoard {
  const inChamber = rows.filter((r) => r.chamber === chamber);
  const partyLineVotes = Math.max(0, ...inChamber.map((r) => r.party_votes));
  const entries: UnityEntry[] = [];
  for (const r of inChamber) {
    const m = members.get(r.member_id);
    if (r.party !== party || !m?.current || m.chamber !== chamber) continue;
    if (r.party_votes < Math.max(1, partyLineVotes * minShare)) continue;
    entries.push({
      id: m.bioguide_id,
      name: m.name,
      state: m.state,
      district: m.district,
      share: r.with_party / r.party_votes,
      with: r.with_party,
      of: r.party_votes,
    });
  }
  const byShare = [...entries].sort((a, b) => b.share - a.share || b.of - a.of || a.name.localeCompare(b.name));
  const mid = byShare.length ? byShare[Math.floor((byShare.length - 1) / 2)]!.share : null;
  return {
    most: byShare.slice(0, n),
    least: [...byShare].reverse().slice(0, n),
    median: mid,
    ranked: byShare.length,
    partyLineVotes,
  };
}

export interface DonorEntry {
  key: string;
  name: string;
  total: number;
  /** Members it appears among the top contributors of. */
  members: number;
  /** Totals by the receiving member's party. */
  byParty: { D: number; R: number; other: number };
}

const recipientParty = (m: Member | undefined): 'D' | 'R' | 'other' => {
  const p = partyLetter(m?.party);
  return p === 'D' ? 'D' : p === 'R' ? 'R' : 'other';
};

function board(
  finance: Iterable<MemberFinance>,
  members: Map<string, Member>,
  entriesOf: (f: MemberFinance) => { key: string; name: string; total: number }[],
  n: number,
): DonorEntry[] {
  const out = new Map<string, DonorEntry>();
  for (const f of finance) {
    const party = recipientParty(members.get(f.member_id));
    for (const e of entriesOf(f)) {
      if (!e.key || !(e.total > 0)) continue;
      const d = out.get(e.key) ?? { key: e.key, name: e.name, total: 0, members: 0, byParty: { D: 0, R: 0, other: 0 } };
      d.total += e.total;
      d.members += 1;
      d.byParty[party] += e.total;
      out.set(e.key, d);
    }
  }
  return [...out.values()].sort((a, b) => b.total - a.total || b.members - a.members).slice(0, n);
}

/** PACs and other committees, by what they gave to members where they rank among the member's top contributors. */
export function pacBoard(finance: Iterable<MemberFinance>, members: Map<string, Member>, n = 15): DonorEntry[] {
  return board(
    finance,
    members,
    (f) =>
      (f.top_committees ?? []).map((c) => ({
        key: c.id ?? c.name.trim().toUpperCase(),
        name: c.name,
        total: Number(c.total),
      })),
    n,
  );
}

/** Employers named by individual donors (money from people who work there, not from the company). */
export function employerBoard(finance: Iterable<MemberFinance>, members: Map<string, Member>, n = 15): DonorEntry[] {
  const skip =
    /^(N\/?A|NONE|SELF[- ]?EMPLOYED|SELF|RETIRED|NOT EMPLOYED|UNEMPLOYED|INFORMATION REQUESTED.*|HOMEMAKER|REQUESTED)$/i;
  return board(
    finance,
    members,
    (f) =>
      (f.top_employers ?? [])
        .filter((e) => e.name && !skip.test(e.name.trim()))
        .map((e) => ({ key: e.name.trim().toUpperCase(), name: e.name.trim(), total: Number(e.total) })),
    n,
  );
}

/** "Pac Name Inc" from "PAC NAME INC" for display; keeps short all-caps acronyms (AIPAC, PAC, LLC). */
export function donorName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/\b([a-z])([a-z']*)/g, (_, a: string, b: string) => a.toUpperCase() + b)
    .replace(/\b(Pac|Llc|Inc|Usa|Us|Afl|Cio|Ibew|Seiu|Aipac|Nra|Ups|At&t|Pc|Lp|Llp)\b/g, (w) => w.toUpperCase());
}
