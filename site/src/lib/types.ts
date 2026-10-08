import type { BillStatus } from '@civic/congress-client/status';

export interface Member {
  bioguide_id: string;
  name: string;
  sort_name: string | null;
  party: string | null;
  party_name: string | null;
  state: string | null;
  district: number | null;
  chamber: 'house' | 'senate' | null;
  current: boolean;
  photo_url: string | null;
  lis_id?: string | null;
  website: string | null;
  phone: string | null;
  office: string | null;
  contact_form: string | null;
  social: Record<string, string> | null;
}

export interface Bill {
  id: string;
  congress: number;
  bill_type: string;
  number: number;
  origin_chamber: 'house' | 'senate' | null;
  title: string;
  short_title: string | null;
  introduced_date: string | null;
  sponsor_id: string | null;
  policy_area: string | null;
  latest_action_date: string | null;
  latest_action_text: string | null;
  status: BillStatus;
  summary_text: string | null;
  text_url: string | null;
  congress_gov_url: string | null;
  law_number: string | null;
  update_date: string | null;
  cosponsors_count: number;
}

export interface BillAction {
  bill_id: string;
  seq: number;
  action_date: string | null;
  text: string;
  action_code: string | null;
  action_type: string | null;
  chamber: 'house' | 'senate' | null;
  source_system: string | null;
}

export interface Cosponsor {
  bill_id: string;
  member_id: string;
  sponsored_date: string | null;
  withdrawn_date: string | null;
  is_original: boolean;
}

/** Columns needed for bill lists. */
export const BILL_LIST_COLUMNS =
  'id,congress,bill_type,number,title,short_title,introduced_date,latest_action_date,latest_action_text,status,sponsor_id,policy_area';

export const BILL_PAGE_COLUMNS =
  'id,congress,bill_type,number,origin_chamber,title,short_title,introduced_date,sponsor_id,policy_area,latest_action_date,latest_action_text,status,summary_text,text_url,congress_gov_url,law_number,update_date,cosponsors_count';

export const MEMBER_COLUMNS =
  'bioguide_id,name,sort_name,party,party_name,state,district,chamber,current,photo_url,website,phone,office,contact_form,social';

export type BillListItem = Pick<
  Bill,
  | 'id'
  | 'congress'
  | 'bill_type'
  | 'number'
  | 'title'
  | 'short_title'
  | 'introduced_date'
  | 'latest_action_date'
  | 'latest_action_text'
  | 'status'
  | 'sponsor_id'
  | 'policy_area'
>;

export interface LocalOfficial {
  id: string;
  city: string;
  person_id: number;
  name: string;
  seat: string | null;
  district: number | null;
  title: string | null;
  email: string | null;
  photo_url: string | null;
  current: boolean;
}

export interface LocalMatter {
  id: string;
  city: string;
  matter_id: number;
  file_number: string | null;
  title: string;
  type: string | null;
  status: string | null;
  body: string | null;
  intro_date: string | null;
  passed_date: string | null;
  legistar_url: string | null;
  latest_action_date: string | null;
  latest_action_text: string | null;
}

export interface LocalMatterAction {
  matter_id: string;
  seq: number;
  action_date: string | null;
  action_name: string | null;
  action_text: string | null;
  body: string | null;
  passed: string | null;
}

export interface LocalMeeting {
  id: string;
  event_id: number;
  body: string | null;
  starts_at: string | null;
  date: string;
  time: string | null;
  location: string | null;
  agenda_url: string | null;
  minutes_url: string | null;
  legistar_url: string | null;
}

export const LOCAL_MATTER_COLUMNS =
  'id,city,matter_id,file_number,title,type,status,body,intro_date,passed_date,legistar_url,latest_action_date,latest_action_text';
export const LOCAL_OFFICIAL_COLUMNS = 'id,city,person_id,name,seat,district,title,email,photo_url,current';

export type DiscussionTargetType = 'bill' | 'state_bill' | 'local_matter';

export interface Discussion {
  id: string;
  title: string;
  prompt: string;
  jurisdiction: 'federal' | 'ma' | 'boston';
  district: number | null;
  target_type: DiscussionTargetType | null;
  target_id: string | null;
  status: 'draft' | 'open' | 'closed';
  residency_required: boolean;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
}

export interface StateBill {
  id: string;
  state: string;
  session: string;
  identifier: string;
  title: string;
  chamber: string | null;
  latest_action_date: string | null;
  latest_action_text: string | null;
  primary_sponsor_id: string | null;
  primary_sponsor_name: string | null;
  openstates_url: string | null;
}

export const STATE_BILL_COLUMNS =
  'id,state,session,identifier,title,chamber,latest_action_date,latest_action_text,primary_sponsor_id,primary_sponsor_name,openstates_url';
