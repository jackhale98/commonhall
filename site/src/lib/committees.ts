/** Committees, rosters, referrals and meetings as stored by sync-committees. */
export interface Committee {
  code: string;
  parent_code: string | null;
  chamber: 'house' | 'senate' | 'joint';
  name: string;
  url: string | null;
  jurisdiction: string | null;
  phone: string | null;
}

export interface CommitteeMember {
  committee_code: string;
  member_id: string;
  side: 'majority' | 'minority';
  rank: number;
  title: string | null;
}

export interface BillCommittee {
  bill_id: string;
  committee_code: string;
  committee_name: string | null;
  referred_date: string | null;
  reported_date: string | null;
  last_action_date: string | null;
  last_action_text: string | null;
}

export interface CommitteeMeeting {
  id: string;
  chamber: 'house' | 'senate' | 'joint';
  date: string | null;
  title: string | null;
  meeting_type: string | null;
  status: string | null;
  location: string | null;
  committee_codes: string[];
  committee_names: string[];
  witnesses: { name: string; organization: string | null; position: string | null }[];
  bill_ids: string[];
  video_url: string | null;
  url: string;
}

export const COMMITTEE_COLUMNS = 'code,parent_code,chamber,name,url,jurisdiction,phone';
export const COMMITTEE_MEMBER_COLUMNS = 'committee_code,member_id,side,rank,title';
export const BILL_COMMITTEE_COLUMNS =
  'bill_id,committee_code,committee_name,referred_date,reported_date,last_action_date,last_action_text';
export const COMMITTEE_MEETING_COLUMNS =
  'id,chamber,date,title,meeting_type,status,location,committee_codes,committee_names,witnesses,bill_ids,video_url,url';

/** "House Committee on Agriculture" → "Agriculture"; used where the chamber is already shown. */
export function shortCommitteeName(name: string): string {
  return name.replace(/^(House|Senate|Joint) (Select |Permanent Select |Special )?Committee on (the )?/i, '').trim();
}

export function chamberLabel(chamber: Committee['chamber']): string {
  return chamber === 'house' ? 'House' : chamber === 'senate' ? 'Senate' : 'Joint';
}

/** Leadership first (chair, ranking member, vice chair), then rank. */
export function rosterOrder(a: CommitteeMember, b: CommitteeMember): number {
  const lead = (m: CommitteeMember) =>
    m.title ? (/chair/i.test(m.title) && !/vice/i.test(m.title) ? 0 : /ranking/i.test(m.title) ? 1 : 2) : 3;
  return lead(a) - lead(b) || a.rank - b.rank;
}
