/**
 * CourtListener (Free Law Project) search API v4, used for Supreme Court
 * opinions: https://www.courtlistener.com/help/api/rest/v4/search/
 * Needs a free API token (sent as `Authorization: Token …`). A standard account
 * may make 5 requests a minute, 50 an hour and 125 a day (rolling windows). Field names follow the published v4 docs
 * and CourtListener's search index source (cl/search/documents.py, constants.py).
 */
import { HttpClient, type HttpOptions } from './http.ts';

export const COURTLISTENER_API_BASE = 'https://www.courtlistener.com/api/rest/v4';

/** A nested opinion in a search result. `type` is a slug: lead-opinion, combined-opinion, dissent, … */
export interface ClOpinion {
  id: number;
  author_id: number | null;
  type: string | null;
  per_curiam: boolean;
  joined_by_ids?: number[];
  download_url?: string | null;
}

/** One opinion cluster (a decided case) from /search/?type=o. */
export interface ClCluster {
  cluster_id: number;
  docket_id: number | null;
  absolute_url: string;
  caseName: string;
  caseNameFull?: string;
  citation: string[];
  court_id: string;
  dateFiled: string;
  dateArgued: string | null;
  docketNumber: string | null;
  /** The cluster's judges field: authors or participating justices, free text. */
  judge: string;
  panel_names?: string[];
  opinions: ClOpinion[];
  status: string;
  syllabus: string;
  posture?: string;
  scdb_id?: string;
}

/** An opinion's text, as /opinions/{id}/ returns it (only the fields asked for). */
export interface ClOpinionText {
  id: number;
  plain_text?: string;
  html_with_citations?: string;
}

interface ClPage {
  count?: number;
  next: string | null;
  results: ClCluster[];
}

export class CourtListenerClient {
  readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(options: HttpOptions & { token: string; baseUrl?: string }) {
    if (!options.token) throw new Error('CourtListenerClient requires a token');
    this.baseUrl = (options.baseUrl ?? COURTLISTENER_API_BASE).replace(/\/$/, '');
    this.http = new HttpClient({
      ...options,
      headers: { ...options.headers, authorization: `Token ${options.token}` },
    });
  }

  get budget() {
    return this.http.budget;
  }

  /** Opinion clusters from one court (CourtListener court id: scotus, mass, …) filed in a date range. */
  courtUrl(courtId: string, since: string, until?: string): string {
    const url = new URL(`${this.baseUrl}/search/`);
    url.searchParams.set('type', 'o');
    url.searchParams.set('q', `court_id:${courtId} AND dateFiled:[${since} TO ${until ?? '*'}]`);
    url.searchParams.set('order_by', 'dateFiled desc');
    return url.toString();
  }

  supremeCourtUrl(since: string, until?: string): string {
    return this.courtUrl('scotus', since, until);
  }

  /** One opinion's text: plain text when CourtListener has it, else its HTML. */
  opinionText(id: number): Promise<ClOpinionText> {
    return this.http.getJson<ClOpinionText>(`${this.baseUrl}/opinions/${id}/?fields=id,plain_text,html_with_citations`);
  }

  /** Supreme Court opinion clusters filed from `since` to `until` (YYYY-MM-DD, inclusive), newest first. */
  supremeCourtOpinions(since: string, until?: string): AsyncGenerator<ClCluster> {
    return this.courtOpinions('scotus', since, until);
  }

  /** One court's opinion clusters filed from `since` to `until` (YYYY-MM-DD, inclusive), newest first. */
  async *courtOpinions(courtId: string, since: string, until?: string): AsyncGenerator<ClCluster> {
    let next: string | null = this.courtUrl(courtId, since, until);
    while (next) {
      const page: ClPage = await this.http.getJson<ClPage>(next);
      for (const c of page.results ?? []) yield c;
      next = page.next;
    }
  }
}
