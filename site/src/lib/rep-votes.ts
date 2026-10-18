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
