/**
 * CivicClerk's public API (https://{client}.api.civicclerk.com/v1), which cities such
 * as Bristol, Connecticut use for meeting agendas and minutes. Public OData JSON, no
 * key. The server pages lists at 15 rows and gives the next page as `@odata.nextLink`.
 *
 *   GET /v1/EventCategories                 the boards ("City Council", "Ordinance Committee")
 *   GET /v1/Events?$filter=…&$orderby=…      meetings, with their published files
 *   GET /v1/Meetings/{agendaId}             an agenda: sections and their numbered items
 *   GET /v1/Meetings/GetMeetingFileStream(fileId=…,plainText=false)   a published PDF
 *
 * Start times are the city's wall-clock time written with a "Z" (a 7 pm council
 * meeting is "T19:00:00Z"), so they are read as local times. The API's firewall
 * refuses some non-browser user agents, so the client sends a browser-like one.
 */
import { HttpClient, type HttpOptions } from './http.ts';
import { checkRecord, checkShape, type Shape } from './shape.ts';

export interface CivicClerkFile {
  fileId: number;
  /** "Agenda", "Agenda Packet", "Minutes", "Other". */
  type: string;
  name: string;
  url?: string;
}

export interface CivicClerkEvent {
  id: number;
  eventName: string;
  /** Local wall-clock time with a misleading "Z": "2026-10-13T19:00:00Z". */
  startDateTime: string;
  categoryId: number;
  categoryName: string;
  /** 0 until an agenda is published. */
  agendaId: number;
  eventLocation?: { address1?: string | null; address2?: string | null } | null;
  publishedFiles: CivicClerkFile[];
}

export interface CivicClerkCategory {
  id: number;
  categoryDesc: string;
}

export interface CivicClerkItem {
  id: number;
  /** "2026-2402"; empty for a section heading. */
  agendaObjectItemNumber: string;
  /** "5." for a section, "a." for an item. */
  agendaObjectItemOutlineNumber: string;
  /** The item's text, sometimes with HTML. */
  agendaObjectItemName: string;
  isSection: number;
  childItems?: CivicClerkItem[] | null;
  attachmentsList?: unknown[] | null;
}

export interface CivicClerkMeeting {
  id: number;
  items: CivicClerkItem[];
}

export const CIVICCLERK_EVENT_SHAPE = {
  id: 'number',
  eventName: 'string',
  startDateTime: 'date',
  categoryId: 'number',
  categoryName: 'string',
  agendaId: 'number',
  publishedFiles: 'array',
} satisfies Shape;

export const CIVICCLERK_CATEGORY_SHAPE = { id: 'number', categoryDesc: 'string' } satisfies Shape;

export const CIVICCLERK_ITEM_SHAPE = {
  id: 'number',
  agendaObjectItemNumber: 'string',
  agendaObjectItemOutlineNumber: 'string',
  agendaObjectItemName: 'string',
  childItems: 'array?',
} satisfies Shape;

/** A browser-like user agent: the API's firewall turns some scripted ones away. */
export const CIVICCLERK_USER_AGENT =
  'Mozilla/5.0 (compatible; commonhall/1.0; +https://github.com/jackhale98/commonhall) AppleWebKit/537.36 (KHTML, like Gecko)';

interface ODataPage<T> {
  value: T[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
}

export interface EventQuery {
  /** Category ids (boards) to include; all when omitted. */
  categories?: number[];
  /** Events starting on or after this day (YYYY-MM-DD). */
  since?: string;
  /** Events starting before this day (YYYY-MM-DD). */
  until?: string;
  /** Stop after this many pages (15 events each). Default 40. */
  maxPages?: number;
}

export class CivicClerkClient {
  readonly http: HttpClient;
  readonly client: string;
  readonly baseUrl: string;

  constructor(options: HttpOptions & { client?: string; baseUrl?: string } = {}) {
    this.client = options.client ?? 'bristolct';
    this.http = new HttpClient({ maxAttempts: 4, userAgent: CIVICCLERK_USER_AGENT, ...options });
    this.baseUrl = (options.baseUrl ?? `https://${this.client}.api.civicclerk.com/v1`).replace(/\/$/, '');
  }

  async categories(): Promise<CivicClerkCategory[]> {
    const page = await this.http.getJson<ODataPage<CivicClerkCategory>>(`${this.baseUrl}/EventCategories`);
    return checkShape('CivicClerk categories', page.value ?? [], CIVICCLERK_CATEGORY_SHAPE);
  }

  /** Events oldest first, following the server's pages. */
  async events(query: EventQuery = {}): Promise<CivicClerkEvent[]> {
    const filters: string[] = [];
    if (query.categories?.length) filters.push(`(${query.categories.map((c) => `categoryId eq ${c}`).join(' or ')})`);
    if (query.since) filters.push(`startDateTime ge ${query.since}T00:00:00Z`);
    if (query.until) filters.push(`startDateTime lt ${query.until}T00:00:00Z`);
    const url = new URL(`${this.baseUrl}/Events`);
    if (filters.length) url.searchParams.set('$filter', filters.join(' and '));
    url.searchParams.set('$orderby', 'startDateTime');
    const out: CivicClerkEvent[] = [];
    let next: string | undefined = url.toString();
    for (let pages = 0; next && pages < (query.maxPages ?? 40); pages++) {
      const page: ODataPage<CivicClerkEvent> = await this.http.getJson<ODataPage<CivicClerkEvent>>(next);
      out.push(...checkShape('CivicClerk events', page.value ?? [], CIVICCLERK_EVENT_SHAPE));
      next = page['@odata.nextLink'];
    }
    return out;
  }

  /** An agenda's sections and items. */
  async meeting(agendaId: number): Promise<CivicClerkMeeting> {
    const meeting = await this.http.getJson<CivicClerkMeeting>(`${this.baseUrl}/Meetings/${agendaId}`);
    checkRecord('CivicClerk meeting', meeting, { id: 'number', items: 'array' });
    const all = meeting.items.flatMap((s) => [s, ...(s.childItems ?? [])]);
    checkShape('CivicClerk agenda items', all, CIVICCLERK_ITEM_SHAPE);
    return meeting;
  }

  /** A published file (agenda, packet, minutes) as a PDF link. */
  fileUrl(fileId: number): string {
    return `${this.baseUrl}/Meetings/GetMeetingFileStream(fileId=${fileId},plainText=false)`;
  }

  /** The meeting's page on the public portal. */
  eventUrl(eventId: number): string {
    return `https://${this.client}.portal.civicclerk.com/event/${eventId}/overview`;
  }

  get portalUrl(): string {
    return `https://${this.client}.portal.civicclerk.com/`;
  }
}

/** Agenda item text without HTML: "<strong>Ordinance Committee -&nbsp;</strong>To adopt…" → "Ordinance Committee - To adopt…". */
export function civicClerkText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&#8217;/g, "'")
    .replace(/&lsquo;|&#8216;/g, '‘')
    .replace(/&ldquo;|&rdquo;|&#822[01];/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "2026-10-13T19:00:00Z" → { date: "2026-10-13", time: "7:00 PM" } (the city's own clock). */
export function civicClerkLocal(start: string): { date: string; time: string | null } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(start);
  if (!m) return { date: start.slice(0, 10), time: null };
  const hour = Number(m[2]);
  if (hour === 0 && m[3] === '00') return { date: m[1]!, time: null };
  return { date: m[1]!, time: `${hour % 12 || 12}:${m[3]} ${hour < 12 ? 'AM' : 'PM'}` };
}
