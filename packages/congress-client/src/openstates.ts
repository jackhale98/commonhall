/**
 * Open States API v3 client (https://docs.openstates.org/api-v3/).
 * Rate limits on the free tier are not published and are low, so the client
 * spaces requests out (`minIntervalMs`) in addition to the shared budget.
 */
import { checkShape, type Shape } from './shape.ts';
import { HttpClient, type HttpOptions } from './http.ts';

export const OPENSTATES_BASE = 'https://v3.openstates.org';

export interface OSPagination {
  per_page: number;
  page: number;
  max_page: number;
  total_items: number;
}

export interface OSPage<T> {
  results: T[];
  pagination: OSPagination;
}

export interface OSJurisdictionRef {
  id: string;
  name: string;
  classification: string;
}

export interface OSRole {
  title?: string;
  org_classification?: 'upper' | 'lower' | 'legislature' | 'executive' | string;
  district?: string | number;
  division_id?: string;
}

export interface OSPerson {
  id: string;
  name: string;
  party?: string;
  current_role?: OSRole | null;
  jurisdiction?: OSJurisdictionRef;
  given_name?: string;
  family_name?: string;
  image?: string;
  email?: string;
  openstates_url?: string;
  updated_at?: string;
}

export interface OSSponsorship {
  id?: string;
  name: string;
  entity_type?: string;
  primary?: boolean;
  classification?: string;
  person?: { id: string; name: string } | null;
}

export interface OSBill {
  id: string;
  session: string;
  jurisdiction: OSJurisdictionRef;
  from_organization?: { id?: string; name?: string; classification?: string };
  identifier: string;
  title: string;
  classification?: string[];
  subject?: string[];
  openstates_url?: string;
  first_action_date?: string | null;
  latest_action_date?: string | null;
  latest_action_description?: string | null;
  latest_passage_date?: string | null;
  created_at?: string;
  updated_at?: string;
  sponsorships?: OSSponsorship[];
  /** With include=actions. */
  actions?: OSAction[];
  /** With include=votes. */
  votes?: OSVote[];
  /** With include=abstracts. */
  abstracts?: { abstract: string; note?: string }[];
}

export interface OSAction {
  description: string;
  date?: string;
  order?: number;
  classification?: string[];
  organization?: { name?: string; classification?: string };
}

export interface OSVote {
  id: string;
  motion_text?: string;
  start_date?: string;
  result?: string;
  organization?: { classification?: string };
  counts?: { option: string; value: number }[];
  votes?: { option: string; voter_name: string; voter?: { id: string; name: string } | null }[];
}

export interface OSSession {
  identifier: string;
  name: string;
  classification?: string;
  start_date?: string;
  end_date?: string;
}

export interface OSJurisdiction extends OSJurisdictionRef {
  division_id?: string;
  url?: string;
  legislative_sessions?: OSSession[];
}

export interface OpenStatesClientOptions extends HttpOptions {
  apiKey: string;
  baseUrl?: string;
  /** Minimum spacing between requests. Default 1100 ms. */
  minIntervalMs?: number;
}

/** `ocd-jurisdiction/country:us/state:ca/government` → `ca`. DC and PR are `district`/`territory`. */
export function jurisdictionToState(id: string): string | null {
  const m = /\/(?:state|district|territory):([a-z]{2})\//.exec(id);
  return m ? m[1]!.toUpperCase() : null;
}

export function stateJurisdiction(state: string): string {
  const code = state.toLowerCase();
  if (code === 'dc') return 'ocd-jurisdiction/country:us/district:dc/government';
  if (code === 'pr') return 'ocd-jurisdiction/country:us/territory:pr/government';
  return `ocd-jurisdiction/country:us/state:${code}/government`;
}

/** Pick the session that is current on `today`, falling back to the latest one. */
export function currentSession(sessions: OSSession[], today = new Date()): OSSession | undefined {
  const iso = today.toISOString().slice(0, 10);
  const regular = sessions.filter((s) => !s.classification || s.classification === 'primary');
  const pool = regular.length > 0 ? regular : sessions;
  const active = pool.filter((s) => (!s.start_date || s.start_date <= iso) && (!s.end_date || s.end_date >= iso));
  const byStart = (a: OSSession, b: OSSession) => (a.start_date ?? '').localeCompare(b.start_date ?? '');
  if (active.length > 0) return active.sort(byStart).at(-1);
  return [...pool].sort(byStart).at(-1);
}

/** The fields the state syncs read (shape.ts). */
export const OS_BILL_SHAPE = {
  id: 'string',
  session: 'string',
  identifier: 'string',
  title: 'string',
  updated_at: 'date?',
  latest_action_date: 'date?',
  latest_action_description: 'string?',
  sponsorships: 'array?',
} satisfies Shape;

export const OS_PERSON_SHAPE = {
  id: 'string',
  name: 'string',
  party: 'string?',
  current_role: 'object?',
} satisfies Shape;

export class OpenStatesClient {
  readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: OpenStatesClientOptions) {
    if (!options.apiKey) throw new Error('OpenStatesClient requires an apiKey');
    // This client spaces its own requests (from the end of the previous one), so the shared one is off.
    this.http = new HttpClient({
      ...options,
      minIntervalMs: 0,
      headers: { ...options.headers, 'x-api-key': options.apiKey },
    });
    this.baseUrl = (options.baseUrl ?? OPENSTATES_BASE).replace(/\/$/, '');
    this.minIntervalMs = options.minIntervalMs ?? 1100;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get budget() {
    return this.http.budget;
  }

  private async get<T>(path: string, query: Record<string, string | number | string[] | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, v);
      else url.searchParams.set(key, String(value));
    }
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    try {
      return await this.http.getJson<T>(url.toString());
    } finally {
      this.lastRequestAt = Date.now();
    }
  }

  jurisdictions(): Promise<OSPage<OSJurisdiction>> {
    return this.get('/jurisdictions', {
      classification: 'state',
      include: ['legislative_sessions'],
      per_page: 52,
    });
  }

  async people(jurisdiction: string, page = 1): Promise<OSPage<OSPerson>> {
    const body = await this.get<OSPage<OSPerson>>('/people', { jurisdiction, page, per_page: 50 });
    checkShape('Open States people', body.results ?? [], OS_PERSON_SHAPE);
    return body;
  }

  async bills(options: {
    jurisdiction: string;
    session?: string;
    updatedSince?: string;
    page?: number;
    sort?: 'updated_asc' | 'updated_desc';
    /** Extra detail in the same response, e.g. ['actions', 'votes', 'abstracts']. Sponsors always come. */
    include?: string[];
  }): Promise<OSPage<OSBill>> {
    const body = await this.get<OSPage<OSBill>>('/bills', {
      jurisdiction: options.jurisdiction,
      session: options.session,
      updated_since: options.updatedSince,
      sort: options.sort ?? 'updated_asc',
      include: ['sponsorships', ...(options.include ?? [])],
      page: options.page ?? 1,
      per_page: 20,
    });
    checkShape('Open States bills', body.results ?? [], OS_BILL_SHAPE);
    return body;
  }

  peopleGeo(lat: number, lng: number): Promise<OSPage<OSPerson>> {
    return this.get('/people.geo', { lat, lng });
  }
}
