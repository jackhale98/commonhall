/** Executive orders and nominations as stored by sync-executive. */
export interface ExecutiveOrder {
  document_number: string;
  eo_number: number | null;
  title: string;
  president: string | null;
  president_name: string | null;
  signing_date: string | null;
  publication_date: string;
  html_url: string;
  notes: string | null;
  revokes: number[];
  revoked_by: number[];
}

export const EXECUTIVE_ORDER_COLUMNS =
  'document_number,eo_number,title,president,president_name,signing_date,publication_date,html_url,notes,revokes,revoked_by';

export type NominationStatus =
  | 'received'
  | 'in_committee'
  | 'reported'
  | 'on_calendar'
  | 'floor'
  | 'confirmed'
  | 'rejected'
  | 'withdrawn'
  | 'returned';

export interface Nomination {
  id: string;
  congress: number;
  number: number;
  part: number | null;
  citation: string;
  description: string | null;
  nominee: string | null;
  position: string | null;
  organization: string | null;
  is_military: boolean;
  received_date: string | null;
  latest_action_date: string | null;
  latest_action_text: string | null;
  status: NominationStatus;
}

export const NOMINATION_COLUMNS =
  'id,congress,number,part,citation,description,nominee,position,organization,is_military,received_date,latest_action_date,latest_action_text,status';

export const NOMINATION_STATUS: Record<NominationStatus, { label: string; tone: string; pending: boolean }> = {
  received: { label: 'Received', tone: 'fill-muted', pending: true },
  in_committee: { label: 'In committee', tone: 'fill-muted', pending: true },
  reported: { label: 'Reported by committee', tone: 'fill-sky', pending: true },
  on_calendar: { label: 'Awaiting a floor vote', tone: 'fill-present', pending: true },
  floor: { label: 'On the Senate floor', tone: 'fill-brand', pending: true },
  confirmed: { label: 'Confirmed', tone: 'fill-yea', pending: false },
  rejected: { label: 'Rejected', tone: 'fill-nay', pending: false },
  withdrawn: { label: 'Withdrawn', tone: 'fill-nv', pending: false },
  returned: { label: 'Returned to the President', tone: 'fill-nv', pending: false },
};

/** Congress.gov page for a nomination, e.g. …/nomination/119th-congress/615 (parts share a page). */
export function nominationUrl(n: Pick<Nomination, 'congress' | 'number'>): string {
  const suffix =
    n.congress % 100 >= 11 && n.congress % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n.congress % 10] ?? 'th');
  return `https://www.congress.gov/nomination/${n.congress}${suffix}-congress/${n.number}`;
}
