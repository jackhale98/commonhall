/**
 * Analyze Boston (data.boston.gov), the City of Boston's open data portal: a CKAN
 * site. No key is needed. Datasets are found by name with package_show; tabular
 * resources live in its datastore and can be read row by row (datastore_search)
 * or summarised in SQL on the city's side (datastore_search_sql). The SQL is
 * read-only Postgres, but some functions are refused (extract(), aggregate
 * FILTER): use date_part() and sum(case …) instead.
 */
import { HttpClient, type HttpOptions } from './http.ts';

export const ANALYZE_BOSTON_BASE = 'https://data.boston.gov/api/3/action';

export interface CkanResource {
  id: string;
  name: string;
  format: string;
  datastore_active: boolean;
  last_modified: string | null;
  url?: string;
}

export interface CkanPackage {
  name: string;
  title: string;
  metadata_modified: string;
  resources: CkanResource[];
  temporal_coverage?: string;
}

interface CkanResponse<T> {
  success: boolean;
  result: T;
  error?: { message?: string; __type?: string };
}

export interface DatastorePage<T> {
  records: T[];
  total?: number;
}

export class AnalyzeBostonClient {
  readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(options: HttpOptions & { baseUrl?: string } = {}) {
    this.baseUrl = (options.baseUrl ?? ANALYZE_BOSTON_BASE).replace(/\/$/, '');
    this.http = new HttpClient(options);
  }

  get budget() {
    return this.http.budget;
  }

  private async call<T>(action: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}/${action}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const body = await this.http.getJson<CkanResponse<T>>(url.toString());
    if (!body.success) throw new Error(`Analyze Boston ${action}: ${body.error?.message ?? 'request failed'}`);
    return body.result;
  }

  /** A dataset and its resources, by its name in the portal's URL (e.g. "capital-budget"). */
  packageShow(name: string): Promise<CkanPackage> {
    return this.call<CkanPackage>('package_show', { id: name });
  }

  /** Read-only SQL over datastore tables (quote a resource id as a table name: "…"). */
  async sql<T>(query: string): Promise<T[]> {
    return (await this.call<DatastorePage<T>>('datastore_search_sql', { sql: query })).records;
  }

  /** One page of a datastore table, optionally filtered by exact column values. */
  search<T>(
    resourceId: string,
    options: { filters?: Record<string, string>; sort?: string; limit?: number; offset?: number } = {},
  ): Promise<DatastorePage<T>> {
    const params: Record<string, string> = {
      resource_id: resourceId,
      limit: String(options.limit ?? 1000),
      offset: String(options.offset ?? 0),
    };
    if (options.filters) params.filters = JSON.stringify(options.filters);
    if (options.sort) params.sort = options.sort;
    return this.call<DatastorePage<T>>('datastore_search', params);
  }

  /** Every row of a datastore table, a page at a time. */
  async *all<T>(resourceId: string, options: { sort?: string; pageSize?: number } = {}): AsyncGenerator<T> {
    const limit = options.pageSize ?? 1000;
    for (let offset = 0; ; offset += limit) {
      const page = await this.search<T>(resourceId, { sort: options.sort, limit, offset });
      for (const r of page.records) yield r;
      if (page.records.length < limit) return;
    }
  }
}

/** The first datastore resource of a dataset whose name matches, newest first. */
export function datastoreResource(pkg: CkanPackage, match: RegExp = /./): CkanResource | undefined {
  return [...pkg.resources]
    .filter((r) => r.datastore_active && match.test(r.name))
    .sort((a, b) => (b.last_modified ?? '').localeCompare(a.last_modified ?? ''))[0];
}
