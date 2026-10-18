/**
 * States we cover in more depth than Open States' basics, and how. Every state's pages
 * are one shared set; a state listed here gets the extras it has data for. Adding one
 * means a sync for the extra data and an entry here; no page code.
 */
import { maBallotIndex } from '@civic/congress-client/ma-ballot';
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
  /** Where the state budget comes from, for the Budget tab (state_budget_lines). */
  budget?: {
    /** Who publishes it: "the Office of the Comptroller". */
    publisher: string;
    /** The site's name and address: CTHRU. */
    site: string;
    url: string;
    /** How the source defines each amount, quoted word for word: our label, the source's column, its definition. */
    definitions: { term: string; column: string; text: string }[];
  };
  /** Where the statewide ballot questions' write-ups come from, for the Ballot questions tab. */
  ballot?: {
    /** Who writes and publishes them: "the Secretary of the Commonwealth". */
    publisher: string;
    /** The guide's name: "Information for Voters". */
    guide: string;
    /** The guide's page for an election year (it has translations and the printed edition). */
    url: (year: number) => string;
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
    budget: {
      publisher: 'the Office of the Comptroller of the Commonwealth',
      site: 'CTHRU',
      url: 'https://www.macomptroller.org/cthru/',
      // CTHRU's data dictionary for "Budget_Actual_With_Other_Spending_Authorizationv3_Gen2".
      definitions: [
        {
          term: 'Original enacted budget',
          column: 'Original Enacted Budget',
          text: 'The Original Enacted Budget is the amount of spending authorized for each appropriation or account in the annual budget bill, or GAA, which is enacted and signed into law prior to or just after the start of each fiscal year.',
        },
        {
          term: 'Supplemental budgets',
          column: 'Supplemental Budget Appropriations',
          text: 'Subsequent to the enactment of the GAA, “supplemental budgets” may be enacted to the extent that some accounts need additional spending authorization during a fiscal year, or new accounts need to be created to fund programs or purposes that were not contemplated when the GAA was signed.',
        },
        {
          term: 'Enacted',
          column: 'Total Enacted Budget Appropriation',
          text: 'The amount of spending authorizations in the GAA and any subsequent supplemental budget acts.',
        },
        {
          term: 'Available',
          column: 'Total Available for Spending',
          text: 'The amount available in an account for expenditure in the fiscal year. Equal to Total Enacted Budget Appropriation + Retained Revenue Collected + Other Spending Authorization minus Planned Savings (9C Spending Cuts).',
        },
        {
          term: 'Spent',
          column: 'Total Expenses',
          text: 'The total amount expended in the fiscal year; for the current active fiscal year (but not for closed fiscal years), this includes the amount of expenses accrued but not yet paid out as cash to vendors.',
        },
      ],
    },
    ballot: {
      publisher: 'the Secretary of the Commonwealth',
      guide: 'Information for Voters',
      url: maBallotIndex,
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
