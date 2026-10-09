/** Supreme Court decisions as stored by sync-scotus. */
export interface ScotusCase {
  cluster_id: number;
  case_name: string;
  docket_number: string | null;
  date_filed: string;
  date_argued: string | null;
  term: number;
  citations: string[];
  url: string;
  dissents: number;
  concurrences: number;
  per_curiam: boolean;
}

export const SCOTUS_COLUMNS =
  'cluster_id,case_name,docket_number,date_filed,date_argued,term,citations,url,dissents,concurrences,per_curiam';

/** October Term year for a date: October 2025 to September 2026 is OT2025. */
export function supremeCourtTerm(date: Date): number {
  return date.getUTCMonth() >= 9 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/** supremecourt.gov docket page, e.g. 22-451. Applications (22A123) and originals use the same path. */
export function docketUrl(docket: string): string {
  return `https://www.supremecourt.gov/docket/docketfiles/html/public/${encodeURIComponent(docket.split(/[,\s]/)[0]!)}.html`;
}
