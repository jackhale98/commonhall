/**
 * USAspending.gov (api.usaspending.gov), the Treasury's public record of federal
 * spending, no key. Two reads: each agency's budget for the fiscal year under way
 * (/api/v2/references/toptier_agencies/), and the money awarded in a fiscal year by
 * where the work is done or the aid is used, per state or congressional district
 * (/api/v2/search/spending_by_geography/, a search sent as a POST that only reads).
 */
import { HttpClient, type HttpOptions } from './http.ts';
import { checkShape, type Shape } from './shape.ts';

export const USASPENDING_BASE = 'https://api.usaspending.gov';

/**
 * USAspending's award type codes, in three groups: contracts (A–D: definitive
 * contracts, purchase orders, delivery and BPA orders), grants (02–05: block,
 * formula, project and cooperative agreements), and other financial assistance
 * (06–11: direct payments, loans, insurance and the rest).
 */
export const AWARD_GROUPS = {
  contracts: ['A', 'B', 'C', 'D'],
  grants: ['02', '03', '04', '05'],
  other: ['06', '07', '08', '09', '10', '11'],
} as const;
export type AwardGroup = keyof typeof AWARD_GROUPS;

export interface ToptierAgency {
  toptier_code: string;
  abbreviation: string;
  agency_name: string;
  agency_slug: string;
  /** The fiscal year and quarter the amounts are reported through ("2026", "4"). */
  active_fy: string;
  active_fq: string;
  budget_authority_amount: number;
  obligated_amount: number;
  outlay_amount: number;
  percentage_of_total_budget_authority: number;
  congressional_justification_url: string | null;
}

export const TOPTIER_AGENCY_SHAPE: Shape = {
  toptier_code: 'string',
  abbreviation: 'string?',
  agency_name: 'string',
  agency_slug: 'string',
  active_fy: 'string',
  active_fq: 'string',
  budget_authority_amount: 'number',
  obligated_amount: 'number',
  outlay_amount: 'number',
  percentage_of_total_budget_authority: 'number',
  congressional_justification_url: 'string?',
};

/** One state ("MA", "Massachusetts") or district ("2509", "MA-09") and what was awarded there. */
export interface GeographyAmount {
  shape_code: string;
  display_name: string;
  aggregated_amount: number;
  population: number | null;
  per_capita: number | null;
}

export const GEOGRAPHY_SHAPE: Shape = {
  shape_code: 'string',
  display_name: 'string',
  aggregated_amount: 'number',
  population: 'number?',
  per_capita: 'number?',
};

export type GeoLayer = 'state' | 'district';

export class UsaSpendingClient {
  readonly http: HttpClient;
  readonly baseUrl: string;

  constructor(options: HttpOptions & { baseUrl?: string } = {}) {
    const { baseUrl, ...http } = options;
    this.baseUrl = (baseUrl ?? USASPENDING_BASE).replace(/\/$/, '');
    this.http = new HttpClient({ maxAttempts: 4, timeoutMs: 90_000, ...http });
  }

  get budget() {
    return this.http.budget;
  }

  /** Every top-tier agency (departments and independent agencies) with its budget for the year under way. */
  async toptierAgencies(): Promise<ToptierAgency[]> {
    const body = await this.http.getJson<{ results?: ToptierAgency[] }>(
      `${this.baseUrl}/api/v2/references/toptier_agencies/`,
    );
    return checkShape('USAspending agencies', body.results ?? [], TOPTIER_AGENCY_SHAPE);
  }

  /**
   * The money obligated in a federal fiscal year (October to September) by where it
   * is spent (place of performance), per state or per congressional district, for
   * one group of award types.
   */
  async spendingByGeography(layer: GeoLayer, fiscalYear: number, group: AwardGroup): Promise<GeographyAmount[]> {
    const request = {
      scope: 'place_of_performance',
      geo_layer: layer,
      filters: {
        award_type_codes: AWARD_GROUPS[group],
        time_period: [{ start_date: `${fiscalYear - 1}-10-01`, end_date: `${fiscalYear}-09-30` }],
      },
    };
    const response = await this.http.post(
      `${this.baseUrl}/api/v2/search/spending_by_geography/`,
      JSON.stringify(request),
      'application/json',
      'application/json',
    );
    const body = (await response.json()) as { geo_layer?: string; results?: GeographyAmount[] };
    if (body.geo_layer && body.geo_layer !== layer)
      throw new Error(`USAspending geography: asked for ${layer}, got ${body.geo_layer}`);
    return checkShape(`USAspending ${layer} ${group} FY${fiscalYear}`, body.results ?? [], GEOGRAPHY_SHAPE);
  }
}
