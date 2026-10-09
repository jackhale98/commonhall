/**
 * Federal Register API client (https://www.federalregister.gov/developers/documentation/api/v1).
 * No key is needed. Only presidential documents of type "executive_order" are
 * read; field names were checked against live responses (test/fixtures/federal-register).
 */
import { HttpClient, type HttpOptions } from './http.ts';

export const FEDERAL_REGISTER_API_BASE = 'https://www.federalregister.gov/api/v1';

/** One executive order as returned with the fields requested below. */
export interface FrExecutiveOrder {
  document_number: string;
  /** A string in the API, e.g. "14434"; null for a few older documents. */
  executive_order_number: string | number | null;
  title: string;
  signing_date: string | null;
  publication_date: string;
  president: { identifier: string; name: string } | null;
  html_url: string;
  pdf_url: string | null;
  abstract: string | null;
  citation: string | null;
  /** e.g. "Revokes: EO 14148, January 20, 2025; See: EO 14252". */
  disposition_notes: string | null;
}

interface FrPage {
  count: number;
  total_pages?: number;
  next_page_url?: string | null;
  results?: FrExecutiveOrder[];
}

const FIELDS = [
  'document_number',
  'executive_order_number',
  'title',
  'signing_date',
  'publication_date',
  'president',
  'html_url',
  'pdf_url',
  'abstract',
  'citation',
  'disposition_notes',
] as const;

export class FederalRegisterClient {
  readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(options: HttpOptions & { baseUrl?: string } = {}) {
    this.baseUrl = (options.baseUrl ?? FEDERAL_REGISTER_API_BASE).replace(/\/$/, '');
    this.http = new HttpClient(options);
  }

  get budget() {
    return this.http.budget;
  }

  executiveOrdersUrl(options: { publishedSince?: string; perPage?: number } = {}): string {
    const url = new URL(`${this.baseUrl}/documents.json`);
    const q = url.searchParams;
    q.append('conditions[type][]', 'PRESDOCU');
    q.append('conditions[presidential_document_type][]', 'executive_order');
    if (options.publishedSince) q.set('conditions[publication_date][gte]', options.publishedSince);
    q.set('order', 'newest');
    q.set('per_page', String(options.perPage ?? 500));
    for (const f of FIELDS) q.append('fields[]', f);
    return url.toString();
  }

  /** Executive orders, newest first, following next_page_url. Pass publishedSince (YYYY-MM-DD) for an update. */
  async *executiveOrders(
    options: { publishedSince?: string; perPage?: number } = {},
  ): AsyncGenerator<FrExecutiveOrder> {
    let next: string | null | undefined = this.executiveOrdersUrl(options);
    while (next) {
      const page: FrPage = await this.http.getJson<FrPage>(next);
      for (const doc of page.results ?? []) yield doc;
      next = page.next_page_url;
    }
  }
}
