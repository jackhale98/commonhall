/**
 * States we cover in more depth than Open States' basics, and how. Every state's pages
 * are one shared set; a state listed here gets the extras it has data for. Adding one
 * means a sync for the extra data and an entry here; no page code.
 */
import { ctLegislatureUrl, maLegislatureUrl } from './paths';

export interface StateFeatures {
  /** A card on the states page and an entry in the menu. */
  featured: { kicker: string; blurb: string };
  /** Discussions can be opened on its bills (the jurisdiction key, e.g. "ma"). */
  discussions: boolean;
  /** The bill's page on the legislature's own site. */
  officialBillUrl?: (session: string, identifier: string) => string | null;
  /** Where the governor's executive orders come from, for the Governor tab and order pages. */
  orders?: {
    /** The site's name, in "Read the order on …". */
    site: string;
    /** The list we read. */
    url: string;
    /** Who publishes the list: "the Trial Court Law Libraries’ list of governors’ executive orders". */
    list: string;
    /** What the order's title is ("its title", "the Governor’s office’s description of it"). */
    titleNote?: string;
  };
}

export const STATE_FEATURES: Record<string, StateFeatures> = {
  MA: {
    featured: {
      kicker: 'Most detailed coverage',
      blurb: 'Bills with their full history, roll-call votes and co-sponsors.',
    },
    discussions: true,
    officialBillUrl: maLegislatureUrl,
    orders: {
      site: 'mass.gov',
      url: 'https://www.mass.gov/massachusetts-executive-orders',
      list: 'the Trial Court Law Libraries’ list of governors’ executive orders',
    },
  },
  CT: {
    featured: {
      kicker: 'In depth',
      blurb: 'Bills with their full history and floor roll calls, the governor’s orders and Supreme Court decisions.',
    },
    discussions: true,
    officialBillUrl: ctLegislatureUrl,
    orders: {
      site: 'portal.ct.gov',
      url: 'https://portal.ct.gov/governor/governors-actions/executive-orders',
      list: 'the Governor’s office list of executive orders',
      titleNote: 'Titles are the Governor’s office’s own one-line descriptions.',
    },
  },
};

/** States whose bills can have discussions, by code. */
export const DISCUSSION_STATES = Object.keys(STATE_FEATURES).filter((code) => STATE_FEATURES[code]!.discussions);

/** Featured states, by code. */
export const FEATURED_STATES = Object.keys(STATE_FEATURES).filter((code) => STATE_FEATURES[code]!.featured);

export const stateFeatures = (code: string): StateFeatures | undefined => STATE_FEATURES[code.toUpperCase()];
