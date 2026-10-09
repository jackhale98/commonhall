/**
 * OpenFEC API client (https://api.open.fec.gov/v1). Uses an api.data.gov key
 * (the same kind as Congress.gov); 1,000 requests an hour on a personal key.
 * Field names were checked against the FEC's OpenAPI spec and live responses
 * (recorded in test/fixtures/fec).
 *
 * Only aggregates are used: totals, contribution sizes, states, employers and
 * PACs. Individual contributors' names are never stored or shown (52 U.S.C.
 * 30111(a)(4) restricts reusing them).
 */
import { HttpClient, type HttpOptions } from './http.ts';

export const FEC_API_BASE = 'https://api.open.fec.gov/v1';

export interface FecPage<T> {
  pagination: { count: number; page?: number; pages: number; per_page: number };
  results: T[];
}

/** /candidate/{id}/totals/ with election_full=true: the whole campaign for the next election. */
export interface FecCandidateTotals {
  candidate_id: string;
  candidate_election_year: number | null;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  receipts: number | null;
  disbursements: number | null;
  last_cash_on_hand_end_period: number | null;
  last_debts_owed_by_committee: number | null;
  individual_contributions: number | null;
  individual_itemized_contributions: number | null;
  individual_unitemized_contributions: number | null;
  other_political_committee_contributions: number | null;
  political_party_committee_contributions: number | null;
  candidate_contribution: number | null;
  loans_made_by_candidate: number | null;
  transfers_from_other_authorized_committee: number | null;
  last_report_type_full: string | null;
}

export interface FecCommittee {
  committee_id: string;
  name: string;
  designation: string | null;
  cycles: number[];
}

export interface FecByEmployer {
  committee_id: string;
  cycle: number;
  employer: string | null;
  total: number;
  count: number | null;
}

/** size is the lower bound of the bucket: 0 (≤ $200), 200, 500, 1000, 2000 (≥ $2,000). */
export interface FecBySize {
  candidate_id: string;
  cycle: number;
  size: number;
  total: number;
  count: number | null;
}

export interface FecByState {
  candidate_id: string;
  cycle: number;
  state: string | null;
  state_full: string | null;
  total: number;
  count: number | null;
}

/** An itemized receipt (Schedule A). Only PAC contributions (line 11C) are requested. */
export interface FecReceipt {
  contributor_id: string | null;
  contributor_name: string | null;
  contribution_receipt_amount: number | null;
  contribution_receipt_date: string | null;
  entity_type: string | null;
}

export interface FecClientOptions extends HttpOptions {
  apiKey: string;
  baseUrl?: string;
}

export class FecClient {
  readonly http: HttpClient;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: FecClientOptions) {
    if (!options.apiKey) throw new Error('FecClient requires an apiKey');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? FEC_API_BASE).replace(/\/$/, '');
    this.http = new HttpClient(options);
  }

  get budget() {
    return this.http.budget;
  }

  url(path: string, query: Record<string, string | number | boolean | undefined> = {}): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    url.searchParams.set('api_key', this.apiKey);
    return url.toString();
  }

  private page<T>(path: string, query: Record<string, string | number | boolean | undefined>): Promise<FecPage<T>> {
    return this.http.getJson<FecPage<T>>(this.url(path, query));
  }

  /** Totals for the whole campaign ending in electionYear (six years for senators, two for representatives). */
  async candidateTotals(candidateId: string, electionYear: number): Promise<FecCandidateTotals | null> {
    const page = await this.page<FecCandidateTotals>(`/candidate/${candidateId}/totals/`, {
      cycle: electionYear,
      election_full: true,
      per_page: 5,
    });
    return page.results[0] ?? null;
  }

  /** The candidate's principal campaign committee (designation P), most recently active first. */
  async principalCommittee(candidateId: string): Promise<FecCommittee | null> {
    const page = await this.page<FecCommittee>(`/candidate/${candidateId}/committees/`, {
      designation: 'P',
      per_page: 10,
    });
    return (
      [...page.results].sort((a, b) => Math.max(0, ...(b.cycles ?? [])) - Math.max(0, ...(a.cycles ?? [])))[0] ?? null
    );
  }

  /** Individual contributions grouped by the donor's employer, largest first (one two-year period). */
  async byEmployer(committeeId: string, cycle: number, perPage = 40): Promise<FecByEmployer[]> {
    return (
      await this.page<FecByEmployer>('/schedules/schedule_a/by_employer/', {
        committee_id: committeeId,
        cycle,
        sort: '-total',
        per_page: perPage,
      })
    ).results;
  }

  async bySize(candidateId: string, electionYear: number): Promise<FecBySize[]> {
    return (
      await this.page<FecBySize>('/schedules/schedule_a/by_size/by_candidate/', {
        candidate_id: candidateId,
        cycle: electionYear,
        election_full: true,
        per_page: 20,
      })
    ).results;
  }

  async byState(candidateId: string, electionYear: number): Promise<FecByState[]> {
    return (
      await this.page<FecByState>('/schedules/schedule_a/by_state/by_candidate/', {
        candidate_id: candidateId,
        cycle: electionYear,
        election_full: true,
        per_page: 100,
      })
    ).results;
  }

  /**
   * The largest PAC contributions in one two-year period: Form 3 line 11C,
   * "contributions from other political committees". A broader committee filter
   * would also return conduit records (ActBlue, WinRed pass-throughs of
   * individuals' money), joint-fundraising transfers and bank interest.
   */
  async pacContributions(committeeId: string, cycle: number, perPage = 100): Promise<FecReceipt[]> {
    return (
      await this.page<FecReceipt>('/schedules/schedule_a/', {
        committee_id: committeeId,
        two_year_transaction_period: cycle,
        line_number: 'F3-11C',
        sort: '-contribution_receipt_amount',
        per_page: perPage,
      })
    ).results;
  }
}

/** The current two-year FEC transaction period (an even year), e.g. 2026 for 2025–2026. */
export function fecTwoYearPeriod(date = new Date()): number {
  const y = date.getUTCFullYear();
  return y % 2 === 0 ? y : y + 1;
}

/** Employer values that describe the donor's situation rather than an organisation. */
const NOT_AN_EMPLOYER =
  /^(none|n\/?a|not employed|unemployed|retired|self[- ]?employed|self|homemaker|student|disabled|information requested( per best efforts)?|requested|refused|null|-|\.)$/i;

export function isOrganisationEmployer(employer: string | null | undefined): boolean {
  const e = (employer ?? '').trim();
  return e.length > 1 && !NOT_AN_EMPLOYER.test(e);
}
