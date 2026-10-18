/**
 * The visitor's districts, kept in this browser when they choose "Remember on this
 * device" under Find my reps, so the home page and people lists can show their own
 * representatives without an account. Like a saved profile, it holds only the place
 * (town, state and ZIP) and the districts, never the street address, and it never
 * leaves the browser. head.js reads the same key to mark <html data-area> before
 * first paint, so the home page doesn't flash the address form at a returning visitor.
 */
import type { SavedDistricts } from './auth';

export const AREA_KEY = 'commonhall-area';
/** Fired on window when the remembered area changes. */
export const AREA_EVENT = 'commonhall-area';

export interface MyArea extends SavedDistricts {
  /** "Boston, MA 02201"; null when the street couldn't be told apart from the place. */
  label: string | null;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const text = (v: unknown) => (typeof v === 'string' && v.length <= 80 ? v : null);
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** Check a stored value field by field; anything else in it is dropped. */
export function parseArea(raw: string | null): MyArea | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const state = text(v.state);
    if (!state || !/^[A-Z]{2}$/.test(state)) return null;
    return {
      label: text(v.label),
      state,
      congressional_district: int(v.congressional_district),
      state_upper_district: text(v.state_upper_district),
      state_lower_district: text(v.state_lower_district),
      city: text(v.city),
      council_district: int(v.council_district),
    };
  } catch {
    return null;
  }
}

/** The area remembered in this browser, or null. */
export function deviceArea(): MyArea | null {
  return parseArea(storage()?.getItem(AREA_KEY) ?? null);
}

export function rememberArea(area: MyArea): void {
  storage()?.setItem(AREA_KEY, JSON.stringify(area));
  document.documentElement.dataset.area = '';
  window.dispatchEvent(new Event(AREA_EVENT));
}

export function forgetArea(): void {
  storage()?.removeItem(AREA_KEY);
  delete document.documentElement.dataset.area;
  window.dispatchEvent(new Event(AREA_EVENT));
}
