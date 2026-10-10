import { billLabel, parseBillId } from '@civic/congress-client/ids';
import type { PolisProfile } from './auth';
import { CITIES, cityOf, idWithinCity } from './cities';
import { congressLabel, stateName } from './format';
import {
  billFallbackHref,
  billHref,
  executiveOrderHref,
  localMatterHref,
  capitalProjectHref,
  scotusCaseHref,
  stateBillFallbackHref,
} from './paths';
import type { Discussion } from './types';

export const DISCUSSION_COLUMNS =
  'id,title,prompt,jurisdiction,district,target_type,target_id,status,residency_required,opens_at,closes_at,created_at';

export function jurisdictionLabel(d: Pick<Discussion, 'jurisdiction' | 'district'>): string {
  if (d.jurisdiction === 'federal') return 'United States';
  if (/^[a-z]{2}$/.test(d.jurisdiction)) return stateName(d.jurisdiction.toUpperCase());
  const city = CITIES[d.jurisdiction]?.name ?? d.jurisdiction;
  return d.district ? `${city}, District ${d.district}` : city;
}

/** Is the discussion accepting votes and comments right now? */
export function isAcceptingInput(d: Pick<Discussion, 'status' | 'opens_at' | 'closes_at'>, now = new Date()): boolean {
  if (d.status !== 'open') return false;
  if (d.opens_at && new Date(d.opens_at) > now) return false;
  if (d.closes_at && new Date(d.closes_at) <= now) return false;
  return true;
}

/**
 * Residency (honor system): the address the user saved under Find my reps must be
 * in the discussion's jurisdiction, and in its council district if it has one.
 */
export function meetsResidency(
  d: Pick<Discussion, 'jurisdiction' | 'district' | 'residency_required'>,
  p: Pick<PolisProfile, 'state' | 'city' | 'councilDistrict'> | null,
): boolean {
  if (!d.residency_required) return true;
  if (!p?.state) return false;
  if (d.jurisdiction === 'federal') return true;
  if (/^[a-z]{2}$/.test(d.jurisdiction)) return p.state === d.jurisdiction.toUpperCase();
  if (p.city !== d.jurisdiction) return false;
  return d.district === null || p.councilDistrict === d.district;
}

/** Link to the bill or council matter a discussion is about. */
export function targetHref(type: Discussion['target_type'], id: string | null): string | null {
  if (!type || !id) return null;
  if (type === 'bill') {
    const ref = parseBillId(id);
    return ref ? billHref(ref.congress, ref.type, ref.number) : billFallbackHref(id);
  }
  if (type === 'state_bill') return stateBillFallbackHref(id);
  if (type === 'executive_order') return executiveOrderHref(id);
  if (type === 'scotus_case') return scotusCaseHref(id);
  if (type === 'capital_project') return capitalProjectHref(id);
  return localMatterHref(id);
}

export function targetLabel(type: Discussion['target_type'], id: string | null): string | null {
  if (!type || !id) return null;
  if (type === 'bill') {
    const ref = parseBillId(id);
    return ref ? `${billLabel(ref.type, ref.number)}, ${congressLabel(ref.congress)}` : id;
  }
  if (type === 'state_bill') return 'the state bill';
  if (type === 'executive_order') return 'the executive order';
  if (type === 'scotus_case') return 'the Supreme Court decision';
  if (type === 'capital_project') return `the ${cityOf(id)?.name ?? 'city'} capital project`;
  return `${cityOf(id)?.name ?? 'City'} council matter ${idWithinCity(id)}`;
}
