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
