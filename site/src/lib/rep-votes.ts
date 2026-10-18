/**
 * How the visitor's members of Congress voted lately (the home page's Your government):
 * their positions on the newest roll calls, grouped by vote.
 */
import { voteAbout } from './votes';

export interface RepVoteRow {
  member_id: string;
  vote_id: string;
  position: 'yea' | 'nay' | 'present' | 'not_voting';
  chamber: 'house' | 'senate';
  date: string | null;
  question: string | null;
  title: string | null;
  result: string | null;
  bill_id: string | null;
  bill_title: string | null;
  yea_total: number;
  nay_total: number;
}

export interface RepVoteGroup {
  row: RepVoteRow;
  positions: { name: string; position: RepVoteRow['position'] }[];
}

/** "Edward J. Markey" → "Markey"; "Thomas R. Suozzi Jr." → "Suozzi". */
export function lastName(name: string): string {
  const parts = name.replace(/,/g, '').split(/\s+/).filter(Boolean);
  while (parts.length > 1 && /^(jr|sr|ii|iii|iv)\.?$/i.test(parts[parts.length - 1]!)) parts.pop();
  return parts[parts.length - 1] ?? name;
}

/**
 * The latest roll calls any of these members cast a vote in, newest first, with each
 * one's position; only the newest vote on each bill or nomination (the confirmation,
 * not the cloture vote before it).
 */
export function groupVotes(rows: RepVoteRow[], names: Map<string, string>, limit = 4): RepVoteGroup[] {
  const groups = new Map<string, RepVoteGroup>();
  const subjects = new Set<string>();
  for (const row of rows) {
    let group = groups.get(row.vote_id);
    if (!group) {
      const subject = row.bill_id ?? voteAbout(row, row.bill_title).subject ?? row.vote_id;
      if (subjects.has(subject) || groups.size >= limit) continue;
      subjects.add(subject);
      group = { row, positions: [] };
      groups.set(row.vote_id, group);
    }
    group.positions.push({ name: names.get(row.member_id) ?? row.member_id, position: row.position });
  }
  for (const g of groups.values()) g.positions.sort((a, b) => a.name.localeCompare(b.name));
  return [...groups.values()];
}

/** A roll call on a bill, as the bill page passes it to Your members of Congress. */
export interface BillVote {
  id: string;
  chamber: 'house' | 'senate';
  question: string | null;
  date: string | null;
}

const SAID: Record<RepVoteRow['position'], string> = {
  yea: 'Yes',
  nay: 'No',
  present: 'Present',
  not_voting: 'Didn’t vote',
};

/**
 * What one of the visitor's members of Congress did on a bill, in plain words:
 * sponsored or cosponsored it, and their position on each roll call in their own
 * chamber, oldest first. A chamber with no roll call on the bill says so (a bill can
 * pass by unanimous consent without one).
 */
export function billRecord(
  rep: { bioguide_id: string; chamber: 'house' | 'senate' | null },
  bill: { sponsorId: string | null; cosponsorIds: string[]; votes: BillVote[] },
  positions: { vote_id: string; member_id: string; position: RepVoteRow['position'] }[],
): string[] {
  const facts: string[] = [];
  if (bill.sponsorId === rep.bioguide_id) facts.push('Sponsored it');
  else if (bill.cosponsorIds.includes(rep.bioguide_id)) facts.push('Cosponsor');
  const theirs = bill.votes
    .filter((v) => v.chamber === rep.chamber)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  for (const v of theirs) {
    const p = positions.find((x) => x.vote_id === v.id && x.member_id === rep.bioguide_id);
    if (p) facts.push(`${SAID[p.position]} on “${v.question ?? 'the roll call'}”`);
  }
  if (theirs.length === 0) facts.push(`No ${rep.chamber === 'senate' ? 'Senate' : 'House'} roll call on it`);
  return facts;
}
