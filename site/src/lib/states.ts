/**
 * States we cover in more depth than Open States' basics, and how. Every state's pages
 * are one shared set; a state listed here gets the extras it has data for. Adding one
 * means a sync for the extra data and an entry here; no page code.
 */
import { maLegislatureUrl } from './paths';

export interface StateFeatures {
  /** A card on the states page and an entry in the menu. */
  featured: { kicker: string; blurb: string };
  /** Discussions can be opened on its bills (the jurisdiction key, e.g. "ma"). */
  discussions: boolean;
  /** The bill's page on the legislature's own site. */
  officialBillUrl?: (session: string, identifier: string) => string | null;
}

export const STATE_FEATURES: Record<string, StateFeatures> = {
  MA: {
    featured: {
      kicker: 'Most detailed coverage',
      blurb: 'Bills with their full history, roll-call votes and co-sponsors.',
    },
    discussions: true,
    officialBillUrl: maLegislatureUrl,
  },
};

/** Featured states, by code. */
export const FEATURED_STATES = Object.keys(STATE_FEATURES).filter((code) => STATE_FEATURES[code]!.featured);

export const stateFeatures = (code: string): StateFeatures | undefined => STATE_FEATURES[code.toUpperCase()];
