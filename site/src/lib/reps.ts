/**
 * The representatives for a set of districts, read from our own tables (no geocoding,
 * no upstream calls): Find my reps for saved districts, and the home page.
 */
import type { SavedDistricts } from './auth';
import { select } from './rest';

export interface FederalRep {
  bioguide_id: string;
  name: string;
  party: string | null;
  state: string | null;
  district: number | null;
  chamber: 'house' | 'senate' | null;
  photo_url: string | null;
}

export interface StateRep {
  id: string;
  name: string;
  party: string | null;
  state: string;
  chamber: string | null;
  district: string | null;
  photo_url: string | null;
  openstates_url: string | null;
}

export interface LocalRep {
  id: string;
  name: string;
  seat: string | null;
  district: number | null;
  photo_url: string | null;
}

export interface Result {
  matchedAddress: string;
  city?: string | null;
  councilDistrict?: number | null;
  localOfficials?: LocalRep[];
  state: string | null;
  congressionalDistrict: number | null;
  stateUpper: string | null;
  stateLower: string | null;
  federal: FederalRep[];
  stateLegislators: StateRep[];
}

export interface Profile extends SavedDistricts {
  /** "Boston, MA 02201": the place only, never the street. */
  address_label: string | null;
}

export async function repsFromProfile(p: Profile): Promise<Result | null> {
  if (!p.state) return null;
  const [federal, upper, lower, local] = await Promise.all([
    select<FederalRep>('members', {
      select: 'bioguide_id,name,party,state,district,chamber,photo_url',
      current: 'eq.true',
      state: `eq.${p.state}`,
      or:
        p.congressional_district === null
          ? '(chamber.eq.senate)'
          : `(chamber.eq.senate,and(chamber.eq.house,district.eq.${p.congressional_district}))`,
      order: 'chamber.desc,name.asc',
    }),
    p.state_upper_district
      ? select<StateRep>('state_legislators', {
          select: 'id,name,party,state,chamber,district,photo_url,openstates_url',
          state: `eq.${p.state}`,
          chamber: 'in.(upper,legislature)',
          district: `eq.${p.state_upper_district}`,
          current: 'eq.true',
        })
      : Promise.resolve([]),
    p.state_lower_district
      ? select<StateRep>('state_legislators', {
          select: 'id,name,party,state,chamber,district,photo_url,openstates_url',
          state: `eq.${p.state}`,
          chamber: 'eq.lower',
          district: `eq.${p.state_lower_district}`,
          current: 'eq.true',
        })
      : Promise.resolve([]),
    p.city && p.council_district !== null
      ? select<LocalRep>('local_officials', {
          select: 'id,name,seat,district,photo_url',
          city: `eq.${p.city}`,
          current: 'eq.true',
          or: `(district.eq.${p.council_district},seat.eq.At-Large)`,
          order: 'district.asc.nullslast,name.asc',
        })
      : Promise.resolve([]),
  ]);
  return {
    matchedAddress: p.address_label ?? '',
    state: p.state,
    congressionalDistrict: p.congressional_district,
    stateUpper: p.state_upper_district,
    stateLower: p.state_lower_district,
    federal,
    stateLegislators: [...upper, ...lower],
    city: p.city,
    councilDistrict: p.council_district,
    localOfficials: local,
  };
}
