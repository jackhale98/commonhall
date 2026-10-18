/**
 * The Treasury's Fiscal Data API (api.fiscaldata.treasury.gov), no key: the Monthly
 * Treasury Statement, the government's own monthly account of the money it took in
 * and paid out. Its Table 9 lists receipts by source and outlays by budget function
 * for the month, the fiscal year to date and the same part of the year before. The
 * API sends every value as a string, and "null" for the headings' empty amounts.
 */
import { HttpClient, type HttpOptions } from './http.ts';
import { checkShape, type Shape } from './shape.ts';

export const FISCAL_DATA_BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts';

/** One line of the statement's Table 9, as the API returns it. */
export interface MtsLine {
  record_date: string;
  classification_desc: string;
  current_month_rcpt_outly_amt: string;
  current_fytd_rcpt_outly_amt: string;
  prior_fytd_rcpt_outly_amt: string;
  /** The line's place in the table: "1", "2", … */
  src_line_nbr: string;
  /** 1 for "Receipts" and "Net Outlays", 2 for their lines, 3 for a line within one. */
  sequence_level_nbr: string;
  /** "1.3.1": the first number is the section, 1 receipts and 2 outlays. */
  sequence_number_cd: string;
  /** S a heading, D a line with amounts, T a total. */
  data_type_cd: string;
}

export const MTS_LINE_SHAPE: Shape = {
  record_date: 'date',
  classification_desc: 'string',
  current_month_rcpt_outly_amt: 'string',
  current_fytd_rcpt_outly_amt: 'string',
  prior_fytd_rcpt_outly_amt: 'string',
  src_line_nbr: 'string',
  sequence_level_nbr: 'string',
  sequence_number_cd: 'string',
  data_type_cd: 'string',
};

interface Page<T> {
  data?: T[];
  meta?: { 'total-count'?: number };
}

export class FiscalDataClient {
  readonly http: HttpClient;
  readonly baseUrl: string;

  constructor(options: HttpOptions & { baseUrl?: string } = {}) {
    const { baseUrl, ...http } = options;
    this.baseUrl = (baseUrl ?? FISCAL_DATA_BASE).replace(/\/$/, '');
    this.http = new HttpClient({ maxAttempts: 4, ...http });
  }

  get budget() {
    return this.http.budget;
  }

  private url(table: string, params: Record<string, string>) {
    const url = new URL(`${this.baseUrl}/${table}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }

  /** The newest statement's date (the last day of its month, e.g. "2026-09-30"), or null. */
  async latestMtsDate(): Promise<string | null> {
    const page = await this.http.getJson<Page<{ record_date?: string }>>(
      this.url('mts_table_9', { fields: 'record_date', sort: '-record_date', 'page[size]': '1' }),
    );
    const date = page.data?.[0]?.record_date;
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  }

  /** Every line of one statement's Table 9, in the table's order. */
  async mtsTable9(recordDate: string): Promise<MtsLine[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) throw new Error(`Not a statement date: ${recordDate}`);
    const page = await this.http.getJson<Page<MtsLine>>(
      this.url('mts_table_9', {
        filter: `record_date:eq:${recordDate}`,
        sort: 'src_line_nbr',
        'page[size]': '200',
      }),
    );
    const rows = page.data ?? [];
    const total = page.meta?.['total-count'];
    if (typeof total === 'number' && total > rows.length)
      throw new Error(`Monthly Treasury Statement ${recordDate}: ${total} lines, only ${rows.length} read`);
    return checkShape(`Monthly Treasury Statement ${recordDate}`, rows, MTS_LINE_SHAPE);
  }
}
