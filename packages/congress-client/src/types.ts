/**
 * Congress.gov response types.
 *
 * Item shapes start from the types generated from the published OpenAPI document
 * (`npm run gen:types`). The spec does not describe the response envelopes and
 * omits or misspells several fields that the live API returns (for example
 * `bioguidId` on cosponsors, or `cosponsors`/`subjects`/`summaries` counts on the
 * bill detail), so those are added here. Every field we add is optional: parsers
 * must cope with any of them being absent.
 */
import type { components } from './generated/openapi.ts';

type Schemas = components['schemas'];

export interface Pagination {
  count?: number;
  next?: string;
  prev?: string;
}

/** Every list response: `request`, `pagination` and an endpoint-named array. */
export type Envelope<K extends string, T> = {
  request?: Record<string, unknown>;
  pagination?: Pagination;
} & { [P in K]?: T };

export interface CountRef {
  count?: number;
  url?: string;
}

export interface LatestAction {
  actionDate?: string;
  actionTime?: string;
  text?: string;
}

export type BillListItem = Schemas['Bill'] & {
  introducedDate?: string;
  latestAction?: LatestAction;
};

export type Sponsor = Schemas['Sponsor'] & { district?: number };

export type BillDetail = Omit<Schemas['BillDetail'], 'sponsors' | 'latestAction'> & {
  title?: string;
  type?: string;
  updateDate?: string;
  updateDateIncludingText?: string;
  introducedDate?: string;
  latestAction?: LatestAction;
  sponsors?: Sponsor[];
  cosponsors?: CountRef & { countIncludingWithdrawnCosponsors?: number };
  subjects?: CountRef;
  summaries?: CountRef;
  textVersions?: CountRef;
  titles?: CountRef;
  laws?: Schemas['laws'][];
};

export interface RecordedVoteRef {
  chamber?: string;
  congress?: number;
  date?: string;
  rollNumber?: number;
  sessionNumber?: number;
  url?: string;
}

export type BillAction = Schemas['Actions'] & {
  actionTime?: string;
  committees?: { name?: string; systemCode?: string; url?: string }[];
  recordedVotes?: RecordedVoteRef[];
};

export type Cosponsor = Omit<Schemas['CoSponsor'], 'bioguidId'> & {
  /** The spec says `bioguidId`; the live API says `bioguideId`. Accept both. */
  bioguideId?: string;
  bioguidId?: string;
  middleName?: string;
  sponsorshipWithdrawnDate?: string;
};

export type LegislativeSubject = Schemas['legislativeSubjects'];
export interface BillSubjects {
  legislativeSubjects?: LegislativeSubject[];
  policyArea?: { name?: string };
}

export type BillSummary = Schemas['billSummariesArray'];
export type TextVersion = Schemas['textVersions'];

export interface BillTitle {
  title?: string;
  titleType?: string;
  titleTypeCode?: number;
  updateDate?: string;
  billTextVersionCode?: string;
  billTextVersionName?: string;
  chamberCode?: string;
  chamberName?: string;
}

export type MemberListItem = Omit<Schemas['Members'], 'terms'> & {
  district?: number;
  terms?: { item?: (Schemas['memberTerms'] & { endYear?: number })[] };
};

export type MemberTerm = Schemas['memberDetailTerms'] & { district?: number };

export type MemberDetail = Omit<Schemas['Member'], 'terms'> & {
  currentMember?: boolean;
  lastName?: string;
  district?: number;
  officialWebsiteUrl?: string;
  addressInformation?: {
    officeAddress?: string;
    city?: string;
    district?: string;
    phoneNumber?: string;
    zipCode?: number | string;
  };
  terms?: MemberTerm[];
};

export type HouseVoteListItem = Schemas['HouseVote'] & {
  amendmentType?: string;
  amendmentNumber?: string;
  amendmentAuthor?: string;
};

export type HouseVoteDetail = Schemas['HouseVoteNumberBase'] & {
  voteQuestion?: string;
  votePartyTotal?: Schemas['voteParty'][];
  amendmentType?: string;
  amendmentNumber?: string;
  amendmentAuthor?: string;
};

export type HouseVoteMemberResult = Omit<Schemas['houseVoteResults'], 'bioguideID'> & {
  /** Documented as `bioguideID`; accept the conventional casing as well. */
  bioguideID?: string;
  bioguideId?: string;
};

export type HouseVoteMembers = Schemas['HouseVoteNumberBase'] & {
  voteQuestion?: string;
  results?: HouseVoteMemberResult[];
};

export interface CongressSession {
  chamber?: string;
  number?: number;
  startDate?: string;
  endDate?: string;
  type?: string;
}

export interface CongressInfo {
  name?: string;
  number?: number;
  startYear?: string;
  endYear?: string;
  sessions?: CongressSession[];
}
