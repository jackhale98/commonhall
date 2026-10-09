/**
 * Council matter types hidden from lists by default: consent-agenda resolutions
 * are mostly congratulations and commendations (about 70% of Boston's matters).
 * A toggle shows them, and choosing the type explicitly always does.
 */
export const HIDDEN_MATTER_TYPES = ['Consent Agenda Resolution'];

/** PostgREST filter value excluding the hidden types, e.g. not.in.("Consent Agenda Resolution"). */
export const hiddenTypesFilter = () => `not.in.(${HIDDEN_MATTER_TYPES.map((t) => `"${t}"`).join(',')})`;

/** Boston's sub-pages, in tab order. */
export const BOSTON_TABS = [
  { key: 'overview', label: 'Overview', path: 'boston/' },
  { key: 'council', label: 'Council', path: 'boston/council/' },
] as const;
export type BostonTab = (typeof BOSTON_TABS)[number]['key'];
