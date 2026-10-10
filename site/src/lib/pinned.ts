/**
 * Which people on a page are the signed-in visitor's own representatives, from the
 * districts Find my reps saved (profiles). Used to list them first.
 */
import type { SavedDistricts } from './auth';

export interface PinnedPerson {
  id: string;
  name: string;
  photo_url: string | null;
  /** Congress portraits by Bioguide id. */
  bioguideId?: string;
  /** "Senate · District 3", "District 6". */
  detail: string;
  href: string;
  /** upper / lower / senate / house, for matching the visitor's districts. */
  chamber?: string | null;
  district?: string | number | null;
}

/** Whose districts a person is matched against. */
export type PinScope =
  { kind: 'congress'; state: string } | { kind: 'legislature'; state: string } | { kind: 'council'; city: string };

/** Is this person one of the visitor's own representatives? */
export function isMine(p: Pick<PinnedPerson, 'chamber' | 'district'>, scope: PinScope, d: SavedDistricts): boolean {
  if (scope.kind === 'council') {
    if (d.city !== scope.city || d.council_district === null) return false;
    // At-large councilors represent everyone in the city.
    return p.district === null || p.district === undefined || Number(p.district) === d.council_district;
  }
  if (d.state !== scope.state) return false;
  if (scope.kind === 'congress')
    return p.chamber === 'senate' || (p.chamber === 'house' && Number(p.district) === d.congressional_district);
  if (p.chamber === 'upper') return !!d.state_upper_district && String(p.district) === d.state_upper_district;
  if (p.chamber === 'lower') return !!d.state_lower_district && String(p.district) === d.state_lower_district;
  // One-house legislatures (Nebraska, DC's council): the district is saved as the upper one.
  return !!d.state_upper_district && String(p.district) === d.state_upper_district;
}
