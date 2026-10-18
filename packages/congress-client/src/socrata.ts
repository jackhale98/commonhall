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

  /**
   * A dataset's description from the portal (`/api/views/{id}.json`): its name, when
   * its rows last changed (rowsUpdatedAt, seconds since 1970) and its column names,
   * so a sync can skip an unchanged dataset and notice a renamed column.
   */
  async metadata(dataset: string): Promise<SocrataMetadata> {
    const view = await this.http.getJson<{
      name?: string;
      rowsUpdatedAt?: number;
      columns?: { fieldName?: string }[];
    }>(`https://${this.domain}/api/views/${dataset}.json`);
    return {
      name: view.name ?? dataset,
      rowsUpdatedAt: typeof view.rowsUpdatedAt === 'number' ? new Date(view.rowsUpdatedAt * 1000).toISOString() : null,
      columns: (view.columns ?? []).map((c) => c.fieldName ?? '').filter(Boolean),
    };
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

export interface SocrataMetadata {
  name: string;
  /** When the rows last changed (ISO), or null when the portal doesn't say. */
  rowsUpdatedAt: string | null;
  columns: string[];
}

/** A SoQL string literal. */
export const soqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;
