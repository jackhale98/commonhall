/**
 * Congress.gov API v3 client. Only the endpoints the sync jobs need are wrapped.
 * Every list method is an async generator that follows `pagination.next` until it
 * is absent, so callers can stop early (for example when the budget runs out)
 * without fetching pages they will not use.
 */
import { HttpClient, type HttpOptions } from './http.ts';
import type {
  BillAction,
  BillDetail,
  BillListItem,
  BillSubjects,
  BillSummary,
  BillTitle,
  CongressInfo,
  Cosponsor,
  Envelope,
  HouseVoteDetail,
  HouseVoteListItem,
  HouseVoteMembers,
  MemberDetail,
  MemberListItem,
  NominationListItem,
  SponsoredItem,
  TextVersion,
} from './types.ts';

export const CONGRESS_API_BASE = 'https://api.congress.gov/v3';
export const MAX_PAGE_SIZE = 250;

export interface CongressClientOptions extends HttpOptions {
  apiKey: string;
  baseUrl?: string;
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface ListBillsOptions {
  fromDateTime?: string;
  toDateTime?: string;
  sort?: 'updateDate+asc' | 'updateDate+desc' | 'introducedDate+asc' | 'introducedDate+desc';
  limit?: number;
  offset?: number;
}

/** Congress.gov wants `YYYY-MM-DDTHH:MM:SSZ` with no fractional seconds. */
export function toApiDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class CongressClient {
  readonly http: HttpClient;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: CongressClientOptions) {
    if (!options.apiKey) throw new Error('CongressClient requires an apiKey');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? CONGRESS_API_BASE).replace(/\/$/, '');
    this.http = new HttpClient(options);
  }

  get budget() {
    return this.http.budget;
  }

  /** Build a request URL for an API path (or an absolute API URL). */
  url(pathOrUrl: string, query: Query = {}): string {
    const url = new URL(
      /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${this.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`,
    );
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    url.searchParams.set('format', 'json');
    url.searchParams.set('api_key', this.apiKey);
    // Congress.gov expects literal `+` in sort values (`updateDate+asc`).
    return url.toString().replace(/sort=([A-Za-z]+)%2B(asc|desc)/, 'sort=$1+$2');
  }

  async get<T>(path: string, query: Query = {}): Promise<T> {
    return this.http.getJson<T>(this.url(path, query));
  }

  /**
   * Yield every item of `key` across all pages. `onPage` receives each page's raw
   * envelope, which is useful for checkpointing.
   *
   * `pagination.next` is used only as the "more pages exist" signal: the live API
   * returns malformed next links (the path repeated inside the query string, e.g.
   * `/v3/bill/119?/bill/119?limit=3&offset=3`), so the next page is requested by
   * advancing `offset` ourselves.
   */
  async *paginate<K extends string, T>(
    path: string,
    key: K,
    query: Query = {},
    onPage?: (page: Envelope<K, T[]>, offset: number) => void,
  ): AsyncGenerator<T, void, undefined> {
    const limit = Number(query.limit ?? MAX_PAGE_SIZE);
    let offset = Number(query.offset ?? 0);
    for (;;) {
      const page: Envelope<K, T[]> = await this.http.getJson<Envelope<K, T[]>>(
        this.url(path, { ...query, limit, offset: offset || undefined }),
      );
      onPage?.(page, offset);
      const items = (page[key] ?? []) as T[];
      for (const item of items) yield item;
      offset += items.length;
      const total = page.pagination?.count;
      if (!page.pagination?.next || items.length === 0) return;
      if (typeof total === 'number' && offset >= total) return;
    }
  }

  async collect<K extends string, T>(path: string, key: K, query: Query = {}): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this.paginate<K, T>(path, key, query)) out.push(item);
    return out;
  }

  // ---- Congress ----------------------------------------------------------

  async currentCongress(): Promise<CongressInfo> {
    const body = await this.get<{ congress?: CongressInfo }>('/congress/current');
    if (!body.congress) throw new Error('Unexpected /congress/current response');
    return body.congress;
  }

  // ---- Bills -------------------------------------------------------------

  listBills(congress: number, options: ListBillsOptions = {}): AsyncGenerator<BillListItem> {
    return this.paginate<'bills', BillListItem>(`/bill/${congress}`, 'bills', {
      fromDateTime: options.fromDateTime ? toApiDateTime(options.fromDateTime) : undefined,
      toDateTime: options.toDateTime ? toApiDateTime(options.toDateTime) : undefined,
      sort: options.sort,
      limit: options.limit ?? MAX_PAGE_SIZE,
      offset: options.offset,
    });
  }

  async getBill(congress: number, type: string, number: string | number): Promise<BillDetail> {
    const body = await this.get<{ bill?: BillDetail }>(`/bill/${congress}/${type.toLowerCase()}/${number}`);
    if (!body.bill) throw new Error(`Bill ${congress}-${type}-${number} missing from response`);
    return body.bill;
  }

  getBillActions(congress: number, type: string, number: string | number): Promise<BillAction[]> {
    return this.collect<'actions', BillAction>(billPath(congress, type, number, 'actions'), 'actions');
  }

  getBillCosponsors(congress: number, type: string, number: string | number): Promise<Cosponsor[]> {
    return this.collect<'cosponsors', Cosponsor>(billPath(congress, type, number, 'cosponsors'), 'cosponsors');
  }

  /**
   * Subjects are an object, not an array, so pagination is over
   * `subjects.legislativeSubjects`. Large omnibus bills can exceed one page.
   */
  async getBillSubjects(congress: number, type: string, number: string | number): Promise<BillSubjects> {
    const result: BillSubjects = { legislativeSubjects: [] };
    const path = billPath(congress, type, number, 'subjects');
    let offset = 0;
    for (;;) {
      const page: { subjects?: BillSubjects; pagination?: { next?: string } } = await this.http.getJson(
        this.url(path, { limit: MAX_PAGE_SIZE, offset: offset || undefined }),
      );
      const subjects = page.subjects ?? {};
      const items = subjects.legislativeSubjects ?? [];
      result.legislativeSubjects!.push(...items);
      if (subjects.policyArea?.name) result.policyArea = subjects.policyArea;
      offset += items.length;
      if (!page.pagination?.next || items.length === 0) return result;
    }
  }

  getBillSummaries(congress: number, type: string, number: string | number): Promise<BillSummary[]> {
    return this.collect<'summaries', BillSummary>(billPath(congress, type, number, 'summaries'), 'summaries');
  }

  getBillTitles(congress: number, type: string, number: string | number): Promise<BillTitle[]> {
    return this.collect<'titles', BillTitle>(billPath(congress, type, number, 'titles'), 'titles');
  }

  getBillText(congress: number, type: string, number: string | number): Promise<TextVersion[]> {
    return this.collect<'textVersions', TextVersion>(billPath(congress, type, number, 'text'), 'textVersions');
  }

  // ---- Members -----------------------------------------------------------

  listMembers(congress: number, options: { currentMember?: boolean } = {}): AsyncGenerator<MemberListItem> {
    return this.paginate<'members', MemberListItem>(`/member/congress/${congress}`, 'members', {
      currentMember: options.currentMember,
    });
  }

  listMembersByDistrict(
    congress: number,
    state: string,
    district: number,
    currentMember = true,
  ): Promise<MemberListItem[]> {
    return this.collect<'members', MemberListItem>(
      `/member/congress/${congress}/${state.toUpperCase()}/${district}`,
      'members',
      { currentMember },
    );
  }

  async getMember(bioguideId: string): Promise<MemberDetail> {
    const body = await this.get<{ member?: MemberDetail }>(`/member/${bioguideId}`);
    if (!body.member) throw new Error(`Member ${bioguideId} missing from response`);
    return body.member;
  }

  /** Most recent legislation a member sponsored (first page only). */
  async getSponsoredLegislation(bioguideId: string, limit = 20): Promise<SponsoredItem[]> {
    const body = await this.get<{ sponsoredLegislation?: SponsoredItem[] }>(
      `/member/${bioguideId}/sponsored-legislation`,
      {
        limit,
      },
    );
    return body.sponsoredLegislation ?? [];
  }

  // ---- House votes -------------------------------------------------------

  // ---- Nominations ---------------------------------------------------------

  /** Nominations received in a Congress; fromDateTime limits to those updated since. */
  listNominations(congress: number, options: { fromDateTime?: string } = {}): AsyncGenerator<NominationListItem> {
    return this.paginate<'nominations', NominationListItem>(`/nomination/${congress}`, 'nominations', {
      fromDateTime: options.fromDateTime ? toApiDateTime(options.fromDateTime) : undefined,
      limit: MAX_PAGE_SIZE,
    });
  }

  listHouseVotes(congress: number, session: number): AsyncGenerator<HouseVoteListItem> {
    return this.paginate<'houseRollCallVotes', HouseVoteListItem>(
      `/house-vote/${congress}/${session}`,
      'houseRollCallVotes',
    );
  }

  async getHouseVote(congress: number, session: number, rollNumber: number): Promise<HouseVoteDetail> {
    const body = await this.get<{ houseRollCallVote?: HouseVoteDetail }>(
      `/house-vote/${congress}/${session}/${rollNumber}`,
    );
    if (!body.houseRollCallVote) throw new Error(`House vote ${congress}-${session}-${rollNumber} missing`);
    return body.houseRollCallVote;
  }

  /** Member positions. Currently returned in one response; paginated defensively in case that changes. */
  async getHouseVoteMembers(congress: number, session: number, rollNumber: number): Promise<HouseVoteMembers> {
    const path = `/house-vote/${congress}/${session}/${rollNumber}/members`;
    let merged: HouseVoteMembers | undefined;
    let offset = 0;
    for (;;) {
      const page: { houseRollCallVoteMemberVotes?: HouseVoteMembers; pagination?: { next?: string } } =
        await this.http.getJson(this.url(path, { limit: MAX_PAGE_SIZE, offset: offset || undefined }));
      const votes = page.houseRollCallVoteMemberVotes;
      if (!votes) break;
      const results = votes.results ?? [];
      if (!merged) merged = { ...votes, results: [...results] };
      else merged.results!.push(...results);
      offset += results.length;
      if (!page.pagination?.next || results.length === 0) break;
    }
    if (!merged) throw new Error(`House vote members ${congress}-${session}-${rollNumber} missing`);
    return merged;
  }
}

function billPath(congress: number, type: string, number: string | number, sub: string): string {
  return `/bill/${congress}/${type.toLowerCase()}/${number}/${sub}`;
}
