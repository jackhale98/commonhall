/**
 * Legistar Web API client (https://webapi.legistar.com/v1/{client}). Public, no
 * key. OData-style queries ($filter, $orderby, $top, $skip); responses are bare
 * arrays. Field names below were checked against live Boston responses
 * (recorded in test/fixtures/legistar); many fields are null in practice.
 *
 * Timestamps: *LastModifiedUtc fields are UTC without a zone suffix. EventDate
 * is a local (Eastern) calendar date with EventTime as text ("12:00 PM").
 */
import { checkRecord, checkShape, type Shape } from './shape.ts';
import { HttpClient, type HttpOptions } from './http.ts';

export const LEGISTAR_BASE = 'https://webapi.legistar.com/v1';
/** Legistar caps $top at 1000. */
export const LEGISTAR_PAGE = 1000;

export interface LegistarMatter {
  MatterId: number;
  MatterGuid: string;
  MatterLastModifiedUtc: string;
  MatterFile: string | null;
  MatterName: string | null;
  MatterTitle: string | null;
  MatterTypeName: string | null;
  MatterStatusName: string | null;
  MatterBodyId: number | null;
  MatterBodyName: string | null;
  MatterIntroDate: string | null;
  MatterAgendaDate: string | null;
  MatterPassedDate: string | null;
  MatterEnactmentDate: string | null;
  MatterEnactmentNumber: string | null;
}

export interface LegistarHistory {
  MatterHistoryId: number;
  MatterHistoryEventId: number | null;
  MatterHistoryActionDate: string | null;
  MatterHistoryActionName: string | null;
  MatterHistoryActionText: string | null;
  MatterHistoryActionBodyName: string | null;
  MatterHistoryPassedFlagName: string | null;
  MatterHistoryRollCallFlag: number | null;
  MatterHistoryTally: string | null;
  MatterHistoryMoverName: string | null;
  MatterHistorySeconderName: string | null;
}

export interface LegistarSponsor {
  MatterSponsorMatterId: number;
  MatterSponsorNameId: number | null;
  MatterSponsorName: string | null;
  MatterSponsorSequence: number | null;
}

export interface LegistarEvent {
  EventId: number;
  EventGuid: string;
  EventLastModifiedUtc: string;
  EventBodyId: number;
  EventBodyName: string;
  EventDate: string;
  EventTime: string | null;
  EventLocation: string | null;
  EventAgendaFile: string | null;
  EventMinutesFile: string | null;
  EventAgendaStatusName: string | null;
  EventMinutesStatusName: string | null;
  EventInSiteURL: string | null;
  EventComment: string | null;
}

export interface LegistarEventItem {
  EventItemId: number;
  EventItemEventId: number;
  EventItemMatterId: number | null;
  EventItemMatterFile: string | null;
  EventItemTitle: string | null;
  EventItemActionName: string | null;
  EventItemActionText: string | null;
  EventItemPassedFlagName: string | null;
  EventItemRollCallFlag: number | null;
  EventItemTally: string | null;
  EventItemLastModifiedUtc: string;
}

export interface LegistarVote {
  VoteId: number;
  VotePersonId: number;
  VotePersonName: string | null;
  VoteValueName: string | null;
  VoteResult: number | null;
  VoteEventItemId: number;
}

export interface LegistarOfficeRecord {
  OfficeRecordId: number;
  OfficeRecordPersonId: number;
  OfficeRecordFullName: string;
  OfficeRecordFirstName: string | null;
  OfficeRecordLastName: string | null;
  OfficeRecordEmail: string | null;
  OfficeRecordTitle: string | null;
  OfficeRecordStartDate: string;
  OfficeRecordEndDate: string | null;
  OfficeRecordBodyId: number;
  OfficeRecordMemberType: string | null;
}

/**
 * The fields the sync relies on (shape.ts): Legistar returns every field, null when
 * empty, so the ones we read are required; a missing one means it was renamed.
 */
export const LEGISTAR_SHAPES = {
  matter: {
    MatterId: 'number',
    MatterLastModifiedUtc: 'date',
    MatterFile: 'string',
    MatterTitle: 'string',
    MatterTypeName: 'string',
    MatterStatusName: 'string',
    MatterIntroDate: 'date',
  },
  history: {
    MatterHistoryId: 'number',
    MatterHistoryActionDate: 'date',
    MatterHistoryActionName: 'string',
    MatterHistoryActionText: 'string',
  },
  sponsor: { MatterSponsorNameId: 'number', MatterSponsorName: 'string' },
  event: {
    EventId: 'number',
    EventLastModifiedUtc: 'date',
    EventBodyName: 'string',
    EventDate: 'date',
    EventTime: 'string',
    EventLocation: 'string',
    EventAgendaFile: 'string',
  },
  eventItem: { EventItemId: 'number', EventItemMatterId: 'number', EventItemTitle: 'string' },
  vote: { VotePersonId: 'number', VoteValueName: 'string' },
  officeRecord: { OfficeRecordPersonId: 'number', OfficeRecordFullName: 'string', OfficeRecordStartDate: 'date' },
} satisfies Record<string, Shape>;

/** OData datetime literal: datetime'2026-10-05T00:00:00'. */
export function odataDate(value: string | Date): string {
  const iso = (typeof value === 'string' ? new Date(value.endsWith('Z') ? value : `${value}Z`) : value).toISOString();
  return `datetime'${iso.replace(/\.\d{3}Z$/, '')}'`;
}

/** Legistar UTC timestamps lack a zone; make them ISO 8601 UTC. */
export function legistarUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(/Z|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "EventBodyId eq 138", or "(EventBodyId eq 138 or EventBodyId eq 181)" for several bodies. */
export function bodyFilter(bodyId: number | readonly number[]): string {
  const ids = typeof bodyId === 'number' ? [bodyId] : [...bodyId];
  const terms = ids.map((id) => `EventBodyId eq ${id}`);
  return terms.length === 1 ? terms[0]! : `(${terms.join(' or ')})`;
}

export class LegistarClient {
  readonly http: HttpClient;
  readonly client: string;
  private readonly baseUrl: string;
  private readonly delayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HttpOptions & { client?: string; baseUrl?: string; delayMs?: number } = {}) {
    this.http = new HttpClient({ maxAttempts: 4, ...options });
    this.client = options.client ?? 'boston';
    this.baseUrl = (options.baseUrl ?? LEGISTAR_BASE).replace(/\/$/, '');
    this.delayMs = options.delayMs ?? 0;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get budget() {
    return this.http.budget;
  }

  private async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${this.client}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    if (this.delayMs > 0) await this.sleep(this.delayMs);
    return this.http.getJson<T>(url.toString());
  }

  /** Every row of a list query, page by page. */
  private async all<T>(path: string, query: Record<string, string | number | undefined>): Promise<T[]> {
    const out: T[] = [];
    for (let skip = 0; ; skip += LEGISTAR_PAGE) {
      const page = await this.get<T[]>(path, { ...query, $top: LEGISTAR_PAGE, $skip: skip || undefined });
      out.push(...page);
      if (page.length < LEGISTAR_PAGE) return out;
    }
  }

  async bodyId(name: string): Promise<number | null> {
    return (await this.bodies()).find((b) => b.BodyName === name)?.BodyId ?? null;
  }

  /** Every body (council, committees, boards); names may carry stray spaces. */
  async bodies(): Promise<{ BodyId: number; BodyName: string }[]> {
    return this.get<{ BodyId: number; BodyName: string }[]>('bodies');
  }

  /** Matters of a body modified after `since`, oldest change first. */
  async mattersModifiedSince(bodyId: number, since: string): Promise<LegistarMatter[]> {
    const rows = await this.all<LegistarMatter>('matters', {
      $filter: `MatterBodyId eq ${bodyId} and MatterLastModifiedUtc gt ${odataDate(since)}`,
      $orderby: 'MatterLastModifiedUtc asc',
    });
    return checkShape('Legistar matters', rows, LEGISTAR_SHAPES.matter);
  }

  /** One page of a body's matters introduced on or after `since`, newest first (for the first load). */
  async mattersIntroducedSince(bodyId: number, since: string, skip: number, top = 100): Promise<LegistarMatter[]> {
    const rows = await this.get<LegistarMatter[]>('matters', {
      $filter: `MatterBodyId eq ${bodyId} and MatterIntroDate ge ${odataDate(since)}`,
      $orderby: 'MatterIntroDate desc,MatterId desc',
      $top: top,
      $skip: skip || undefined,
    });
    return checkShape('Legistar matters', rows, LEGISTAR_SHAPES.matter);
  }

  /** A body's (or several bodies') meetings held on or after `date` (including upcoming ones), newest first. */
  async eventsOnOrAfter(bodyId: number | readonly number[], date: string): Promise<LegistarEvent[]> {
    const rows = await this.all<LegistarEvent>('events', {
      $filter: `${bodyFilter(bodyId)} and EventDate ge ${odataDate(date)}`,
      $orderby: 'EventDate desc',
    });
    return checkShape('Legistar events', rows, LEGISTAR_SHAPES.event);
  }

  async matter(id: number): Promise<LegistarMatter> {
    return checkRecord('Legistar matter', await this.get<LegistarMatter>(`matters/${id}`), LEGISTAR_SHAPES.matter);
  }

  async histories(matterId: number): Promise<LegistarHistory[]> {
    const rows = await this.get<LegistarHistory[]>(`matters/${matterId}/histories`);
    return checkShape('Legistar histories', rows, LEGISTAR_SHAPES.history);
  }

  async sponsors(matterId: number): Promise<LegistarSponsor[]> {
    const rows = await this.get<LegistarSponsor[]>(`matters/${matterId}/sponsors`);
    return checkShape('Legistar sponsors', rows, LEGISTAR_SHAPES.sponsor);
  }

  async eventsModifiedSince(bodyId: number | readonly number[], since: string): Promise<LegistarEvent[]> {
    const rows = await this.all<LegistarEvent>('events', {
      $filter: `${bodyFilter(bodyId)} and EventLastModifiedUtc gt ${odataDate(since)}`,
      $orderby: 'EventLastModifiedUtc asc',
    });
    return checkShape('Legistar events', rows, LEGISTAR_SHAPES.event);
  }

  async eventItems(eventId: number): Promise<LegistarEventItem[]> {
    const rows = await this.get<LegistarEventItem[]>(`events/${eventId}/eventitems`);
    return checkShape('Legistar agenda items', rows, LEGISTAR_SHAPES.eventItem);
  }

  async eventItemVotes(eventItemId: number): Promise<LegistarVote[]> {
    const rows = await this.get<LegistarVote[]>(`eventitems/${eventItemId}/votes`);
    return checkShape('Legistar votes', rows, LEGISTAR_SHAPES.vote);
  }

  /** Seats on a body held on a given day. */
  async officeRecords(bodyId: number, on: Date = new Date()): Promise<LegistarOfficeRecord[]> {
    const day = on.toISOString().slice(0, 10);
    const rows = await this.all<LegistarOfficeRecord>('officerecords', {
      $filter: `OfficeRecordBodyId eq ${bodyId} and OfficeRecordStartDate le datetime'${day}' and OfficeRecordEndDate ge datetime'${day}'`,
    });
    return checkShape('Legistar office records', rows, LEGISTAR_SHAPES.officeRecord);
  }
}

/** Public web page for a matter. */
/**
 * Public page for a matter. Legistar's website uses its own page ids and GUIDs,
 * which differ from the API's MatterId/MatterGuid ("Invalid parameters!"), so link
 * through the gateway, which redirects from the API's MatterId.
 */
export function legistarMatterUrl(client: string, matterId: number): string {
  return `https://${client}.legistar.com/gateway.aspx?M=L&ID=${matterId}`;
}
