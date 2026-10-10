/**
 * PrimeGov public portal API (https://{client}.primegov.com), which cities such as
 * Worcester use for meeting agendas and minutes. Public, no key. Responses are
 * JSON arrays of meetings, each with its published documents.
 *
 *   GET /api/v2/PublicPortal/ListUpcomingMeetings
 *   GET /api/v2/PublicPortal/ListArchivedMeetings?year=2026
 *
 * Times are local (Eastern) wall-clock times without a zone.
 */
import { HttpClient, type HttpOptions } from './http.ts';

export interface PrimeGovDocument {
  id: number;
  templateId: number;
  templateName: string;
  compileOutputType: number;
  publishStatus?: number;
}

export interface PrimeGovMeeting {
  id: number;
  committeeId: number;
  title: string;
  /** Local time, e.g. "2026-10-13T18:30:00". */
  dateTime: string;
  date: string;
  time: string;
  location: string | null;
  videoUrl: string | null;
  documentList: PrimeGovDocument[];
}

export class PrimeGovClient {
  readonly http: HttpClient;
  readonly baseUrl: string;

  constructor(options: HttpOptions & { client?: string; baseUrl?: string } = {}) {
    this.http = new HttpClient({ maxAttempts: 4, ...options });
    this.baseUrl = (options.baseUrl ?? `https://${options.client ?? 'worcesterma'}.primegov.com`).replace(/\/$/, '');
  }

  upcoming(): Promise<PrimeGovMeeting[]> {
    return this.http.getJson<PrimeGovMeeting[]>(`${this.baseUrl}/api/v2/PublicPortal/ListUpcomingMeetings`);
  }

  archived(year: number): Promise<PrimeGovMeeting[]> {
    return this.http.getJson<PrimeGovMeeting[]>(
      `${this.baseUrl}/api/v2/PublicPortal/ListArchivedMeetings?year=${year}`,
    );
  }

  /** A published meeting document: the compiled PDF, or the web page for an HTML one (compileOutputType 3). */
  documentUrl(doc: Pick<PrimeGovDocument, 'templateId' | 'compileOutputType'>): string {
    if (doc.compileOutputType === 3) return `${this.baseUrl}/Portal/Meeting?meetingTemplateId=${doc.templateId}`;
    return `${this.baseUrl}/Public/CompiledDocument?meetingTemplateId=${doc.templateId}&compileOutputType=${doc.compileOutputType}`;
  }

  get portalUrl(): string {
    return `${this.baseUrl}/public/portal`;
  }
}
