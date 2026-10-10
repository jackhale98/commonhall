/** State legislators and committees: shared types and labels for their pages. */

export interface StateOffice {
  classification: string | null;
  address: string | null;
  voice: string | null;
  fax: string | null;
}

export interface StateLegislatorDetail {
  id: string;
  name: string;
  party: string | null;
  state: string;
  chamber: string | null;
  district: string | null;
  title: string | null;
  photo_url: string | null;
  email: string | null;
  openstates_url: string | null;
  current: boolean;
  offices: StateOffice[];
  links: string[];
}

export const STATE_LEGISLATOR_COLUMNS =
  'id,name,party,state,chamber,district,title,photo_url,email,openstates_url,current,offices,links';

export interface StateCommittee {
  id: string;
  state: string;
  name: string;
  chamber: string | null;
  classification: string;
  parent_id: string | null;
  url: string | null;
  member_count: number;
}

export const STATE_COMMITTEE_COLUMNS = 'id,state,name,chamber,classification,parent_id,url,member_count';

export interface CommitteeSeat {
  seq: number;
  person_id: string | null;
  name: string;
  role: string | null;
}

/** Lower chambers not called the House. */
const LOWER: Record<string, string> = {
  CA: 'Assembly',
  NV: 'Assembly',
  NY: 'Assembly',
  WI: 'Assembly',
  NJ: 'General Assembly',
  MD: 'House of Delegates',
  VA: 'House of Delegates',
  WV: 'House of Delegates',
  DC: 'Council',
};

/** "Senate" / "House" (or "Assembly", "House of Delegates") / "Joint"; Nebraska and DC have one chamber. */
export function chamberLabel(state: string, chamber: string | null): string {
  if (chamber === 'upper') return state === 'NE' ? 'Legislature' : 'Senate';
  if (chamber === 'lower') return LOWER[state] ?? 'House';
  if (chamber === 'legislature') return state === 'NE' ? 'Legislature' : state === 'DC' ? 'Council' : 'Joint';
  return 'Legislature';
}

/** "District 12" for a bare number, otherwise the name as given ("Second Suffolk"). */
export function districtLabel(district: string | null): string {
  if (!district) return '';
  return /^\d+$/.test(district) ? `District ${district}` : district;
}

/** "State Senator, Second Suffolk" / "State Representative, District 12". */
export function seatLabel(l: {
  state: string;
  chamber: string | null;
  district: string | null;
  title?: string | null;
}): string {
  const lower = LOWER[l.state] ?? '';
  const role =
    l.title ||
    (l.chamber === 'upper'
      ? 'State Senator'
      : l.chamber === 'lower'
        ? lower.endsWith('Assembly')
          ? 'Assembly Member'
          : lower === 'House of Delegates'
            ? 'Delegate'
            : 'State Representative'
        : 'Legislator');
  const district = districtLabel(l.district);
  return district ? `${role}, ${district}` : role;
}

const ROLE_ORDER = ['chair', 'co-chair', 'vice chair', 'ranking member'];

/** Leadership first (chair, co-chair, vice chair, ranking member), then everyone else in listed order. */
export function roleRank(role: string | null): number {
  const r = (role ?? 'member').toLowerCase();
  const exact = ROLE_ORDER.indexOf(r);
  if (exact >= 0) return exact;
  if (r.includes('chair')) return 2.5;
  if (r.includes('ranking')) return 3.5;
  return r === 'member' ? 10 : 9;
}

/** "Chair", "Ranking member"; plain members get no label. */
export function roleLabel(role: string | null): string {
  const r = (role ?? '').trim();
  if (!r || r.toLowerCase() === 'member') return '';
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/** A tel: link target for a listed phone number, or null if it has too few digits. */
export function telHref(voice: string | null): string | null {
  const digits = (voice ?? '').replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 7 ? `tel:${digits}` : null;
}

/** The host of a link, for its label ("malegislature.gov"). */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
