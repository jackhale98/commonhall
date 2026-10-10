/**
 * Socrata open data portals (data.somervillema.gov, data.cambridgema.gov,
 * data.ct.gov, …). No key is needed (an app token only raises rate limits). Rows
 * come from the SODA API, `/resource/{id}.json`, filtered and summarised on the
 * portal's side with SoQL ($select, $where, $group, $order), so we read counts,
 * not individual records, wherever a summary will do.
 */
import { HttpClient, type HttpOptions } from './http.ts';
import { checkShape, type Shape } from './shape.ts';

export interface SocrataQuery {
  $select?: string;
  $where?: string;
  $group?: string;
  $order?: string;
  $limit?: number;
  $offset?: number;
}

export class SocrataClient {
  readonly http: HttpClient;
  readonly domain: string;

  /** `domain`: the portal's host, e.g. "data.somervillema.gov". */
  constructor(domain: string, options: HttpOptions = {}) {
    this.domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.http = new HttpClient({ maxAttempts: 4, ...options });
  }

  get budget() {
    return this.http.budget;
  }

  /** One page of a dataset (by its four-by-four id, e.g. "4pyi-uqq6"). */
  async query<T>(dataset: string, query: SocrataQuery = {}): Promise<T[]> {
    const url = new URL(`https://${this.domain}/resource/${dataset}.json`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    return this.http.getJson<T[]>(url.toString());
  }

  /** Every row of a query, a page at a time, checked against `shape` (shape.ts) when given. */
  async all<T>(dataset: string, query: SocrataQuery = {}, shape?: Shape, pageSize = 5000): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.query<T>(dataset, { ...query, $limit: pageSize, $offset: offset });
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return shape ? checkShape(`Socrata ${this.domain} ${dataset}`, out, shape) : out;
  }
}

/** A SoQL string literal. */
export const soqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;
