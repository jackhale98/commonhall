/**
 * unitedstates/congress-legislators: public-domain data used for the LIS ID →
 * Bioguide ID mapping (Senate votes), plus contact details and social links.
 */
import { HttpClient, type HttpOptions } from './http.ts';

export const LEGISLATORS_BASE = 'https://unitedstates.github.io/congress-legislators';

export interface LegislatorTerm {
  type: 'rep' | 'sen';
  start: string;
  end: string;
  state: string;
  district?: number;
  party?: string;
  url?: string;
  phone?: string;
  address?: string;
  office?: string;
  contact_form?: string;
}

export interface Legislator {
  id: { bioguide: string; lis?: string; govtrack?: number; [key: string]: unknown };
  name: { first?: string; last?: string; official_full?: string; nickname?: string };
  terms: LegislatorTerm[];
}

export interface LegislatorSocial {
  id: { bioguide: string };
  social: {
    twitter?: string;
    facebook?: string;
    youtube?: string;
    youtube_id?: string;
    instagram?: string;
    mastodon?: string;
    bluesky?: string;
  };
}

export interface LegislatorSummary {
  bioguideId: string;
  lisId: string | null;
  name: string | null;
  chamber: 'house' | 'senate';
  state: string;
  district: number | null;
  party: string | null;
  website: string | null;
  phone: string | null;
  office: string | null;
  contactForm: string | null;
}

export function currentTerm(legislator: Legislator): LegislatorTerm | undefined {
  return legislator.terms[legislator.terms.length - 1];
}

export function summarizeLegislator(legislator: Legislator): LegislatorSummary | null {
  const term = currentTerm(legislator);
  if (!term || !legislator.id.bioguide) return null;
  return {
    bioguideId: legislator.id.bioguide,
    lisId: legislator.id.lis ?? null,
    name:
      legislator.name.official_full ??
      ([legislator.name.first, legislator.name.last].filter(Boolean).join(' ') || null),
    chamber: term.type === 'sen' ? 'senate' : 'house',
    state: term.state,
    district: term.type === 'rep' ? (term.district ?? 0) : null,
    party: term.party ?? null,
    website: term.url ?? null,
    phone: term.phone ?? null,
    office: term.office ?? term.address ?? null,
    contactForm: term.contact_form ?? null,
  };
}

/** LIS ID (e.g. `S428`) → Bioguide ID. */
export function lisToBioguideMap(legislators: Legislator[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const l of legislators) {
    if (l.id.lis && l.id.bioguide) map.set(l.id.lis, l.id.bioguide);
  }
  return map;
}

export class LegislatorsClient {
  readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(options: HttpOptions & { baseUrl?: string } = {}) {
    this.http = new HttpClient(options);
    this.baseUrl = (options.baseUrl ?? LEGISLATORS_BASE).replace(/\/$/, '');
  }

  current(): Promise<Legislator[]> {
    return this.http.getJson<Legislator[]>(`${this.baseUrl}/legislators-current.json`);
  }

  /** Historical members; needed to map LIS IDs of senators who have since left. */
  historical(): Promise<Legislator[]> {
    return this.http.getJson<Legislator[]>(`${this.baseUrl}/legislators-historical.json`);
  }

  social(): Promise<LegislatorSocial[]> {
    return this.http.getJson<LegislatorSocial[]>(`${this.baseUrl}/legislators-social-media.json`);
  }
}
