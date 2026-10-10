/**
 * IQM2 / Accela Legislative Management ("MinuteTraq"), the meeting portal some
 * cities use for agendas and legislation (https://{client}.iqm2.com). Public, no
 * key. Cambridge, MA used it through January 2026 (agendas, policy orders, votes).
 *
 * The JSON API under /api/ is undocumented, so every response is checked against
 * the fields we read (shape.ts) and a change fails loudly:
 *
 *   GET /api/Meeting/ListWithMeetingType?Range=2025&Group=1000&Limit=500
 *   GET /api/Meeting/{id}/Outline           the agenda tree
 *   GET /api/MeetingDoc/{id}                one legislative file
 *   GET /api/Department/{id}/Members        a body's members, with titles
 *
 * Sponsors and roll calls are only on the public page of each legislative file,
 * Citizens/Detail_LegiFile.aspx?ID={id}, parsed by `parseLegiFile`.
 */
import { HttpClient, type HttpOptions } from './http.ts';
import { ShapeError, checkRecord, checkShape, type Shape } from './shape.ts';

export interface Iqm2Meeting {
  ID: number;
  Department: { ID: number; Name: string };
  /** Local time with offset, e.g. "2025-12-22T17:30:00.0000000-05:00". */
  Date: string;
  Type: { ID: number; Name: string };
  Location?: { Name?: string; Address?: { Line1?: string; Line2?: string } } | null;
  /** "Scheduled" or "Cancelled". */
  Status: string;
}

export interface Iqm2MeetingFile {
  ID: number;
  Documents: { FileType: string; DownloadURL: string }[];
}

export interface Iqm2MeetingListing {
  Meeting: Iqm2Meeting;
  Agenda?: Iqm2MeetingFile;
  Minutes?: Iqm2MeetingFile;
}

export interface Iqm2OutlineItem {
  ID: number;
  Title: string;
  ItemNumFormatted: string;
  /** "Section", "RollCall", "Resolution" (any legislative file), "Attachment", … */
  ItemType: string;
  WasDeleted?: boolean;
  ReferencedItem?: { ID: number; Type: string };
  ChildItems: Iqm2OutlineItem[];
}

export interface Iqm2Outline {
  Meeting: Iqm2Meeting;
  Agenda?: { ID: number; Outline: Iqm2OutlineItem[] };
}

export interface Iqm2MeetingDoc {
  ID: number;
  ShortTitle: string;
  FullTitle: string;
  Status: string | null;
  FormalNumber: string | null;
  Meeting?: { ID: number };
}

export interface Iqm2Member {
  UserID: number;
  FullName: string;
  /** "Councillor", "Mayor", "Vice Mayor", "Chair", … */
  Title: string | null;
  RollCallSort: number;
}

export const IQM2_MEETING_SHAPE = {
  Meeting: 'object',
} satisfies Shape;
const MEETING_SHAPE = {
  ID: 'number',
  Department: 'object',
  Date: 'date',
  Type: 'object',
  Status: 'string',
} satisfies Shape;
const OUTLINE_ITEM_SHAPE = {
  ID: 'number',
  Title: 'string',
  ItemType: 'string',
  ChildItems: 'array',
  ReferencedItem: 'object?',
} satisfies Shape;
export const IQM2_DOC_SHAPE = {
  ID: 'number',
  ShortTitle: 'string',
  FullTitle: 'string',
  Status: 'string?',
  FormalNumber: 'string',
} satisfies Shape;
export const IQM2_MEMBER_SHAPE = {
  UserID: 'number',
  FullName: 'string',
  Title: 'string?',
} satisfies Shape;

export class Iqm2Client {
  readonly http: HttpClient;
  readonly baseUrl: string;

  /** `client`: the portal's name, e.g. "cambridgema" for cambridgema.iqm2.com. */
  constructor(options: HttpOptions & { client?: string; baseUrl?: string } = {}) {
    this.http = new HttpClient({ maxAttempts: 4, ...options });
    this.baseUrl = (options.baseUrl ?? `https://${options.client ?? 'cambridgema'}.iqm2.com`).replace(/\/$/, '');
  }

  get budget() {
    return this.http.budget;
  }

  /** Meetings of a body (its group id; 1000 is Cambridge's City Council) in a year, newest first. */
  async meetings(year: number, group: number): Promise<Iqm2MeetingListing[]> {
    const rows = await this.http.getJson<Iqm2MeetingListing[]>(
      `${this.baseUrl}/api/Meeting/ListWithMeetingType?Range=${year}&Group=${group}&Limit=500`,
    );
    if (!Array.isArray(rows)) throw new ShapeError('IQM2 meetings', ['response is not a list']);
    checkShape('IQM2 meetings', rows, IQM2_MEETING_SHAPE);
    checkShape(
      'IQM2 meetings',
      rows.map((r) => r.Meeting),
      MEETING_SHAPE,
    );
    return rows;
  }

  /** A meeting's agenda as a tree of sections and items (no Agenda when none is published). */
  async outline(meetingId: number): Promise<Iqm2Outline> {
    const outline = await this.http.getJson<Iqm2Outline>(`${this.baseUrl}/api/Meeting/${meetingId}/Outline`);
    checkRecord('IQM2 outline', outline, { Meeting: 'object', Agenda: 'object?' });
    checkRecord('IQM2 outline', outline.Meeting, MEETING_SHAPE);
    if (outline.Agenda) {
      checkRecord('IQM2 outline', outline.Agenda, { ID: 'number', Outline: 'array' });
      const items = flattenOutline(outline.Agenda.Outline);
      checkShape('IQM2 outline items', items, OUTLINE_ITEM_SHAPE);
    }
    return outline;
  }

  /** One legislative file (its formal number, titles and status). */
  async meetingDoc(id: number): Promise<Iqm2MeetingDoc> {
    const doc = await this.http.getJson<Iqm2MeetingDoc>(`${this.baseUrl}/api/MeetingDoc/${id}`);
    return checkRecord('IQM2 meeting doc', doc, IQM2_DOC_SHAPE);
  }

  /** A body's members, in roll-call order (department 1000: the City Council). */
  async members(departmentId: number): Promise<Iqm2Member[]> {
    const rows = await this.http.getJson<Iqm2Member[]>(`${this.baseUrl}/api/Department/${departmentId}/Members`);
    if (!Array.isArray(rows)) throw new ShapeError('IQM2 members', ['response is not a list']);
    return checkShape('IQM2 members', rows, IQM2_MEMBER_SHAPE);
  }

  /** Every body that has held meetings (council, its committees, boards), by group id. */
  async departments(): Promise<{ ID: number; Name: string }[]> {
    const rows = await this.http.getJson<{ ID: number; Name: string }[]>(
      `${this.baseUrl}/api/Department/LookupsWithMeetings`,
    );
    if (!Array.isArray(rows)) throw new ShapeError('IQM2 departments', ['response is not a list']);
    return checkShape('IQM2 departments', rows, { ID: 'number', Name: 'string' });
  }

  /** The public page of a legislative file, parsed (sponsors, each meeting's result and roll call). */
  async legiFile(id: number): Promise<Iqm2LegiFile> {
    const html = await this.http.getText(this.legiFileUrl(id), 'text/html');
    return parseLegiFile(html, id);
  }

  legiFileUrl(id: number): string {
    return `${this.baseUrl}/Citizens/Detail_LegiFile.aspx?ID=${id}`;
  }

  meetingUrl(id: number): string {
    return `${this.baseUrl}/Citizens/Detail_Meeting.aspx?ID=${id}`;
  }
}

/** Every item in an agenda tree, depth first. */
export function flattenOutline(items: Iqm2OutlineItem[]): Iqm2OutlineItem[] {
  return items.flatMap((i) => [i, ...flattenOutline(i.ChildItems ?? [])]);
}

// ---- Legislative file pages -------------------------------------------------

/** A recorded vote's tally and names (names as printed, e.g. "Marc C. McGovern"). */
export interface Iqm2Vote {
  /** "FAILED OF ADOPTION [4 TO 5]" without the tally: "FAILED OF ADOPTION". */
  result: string;
  yes: number | null;
  no: number | null;
  unanimous: boolean;
  yeas: string[];
  nays: string[];
  absent: string[];
  present: string[];
  recused: string[];
}

/** One meeting in a file's history. */
export interface Iqm2HistoryEntry {
  meetingId: number | null;
  /** YYYY-MM-DD. */
  date: string | null;
  /** "City Council", "Ordinance Committee". */
  body: string | null;
  /** "Regular Meeting". */
  meetingType: string | null;
  /** The clerk's note ("FINALIZED IN COUNCIL DECEMBER 22, 2025"), or null. */
  comments: string | null;
  vote: Iqm2Vote | null;
}

export interface Iqm2LegiFile {
  id: number;
  /** "Policy Order", "City Manager's Agenda Item". */
  fileType: string | null;
  /** "POR 2025 #171". */
  number: string | null;
  /** The stamp, e.g. "FAILED OF ADOPTION" or "PLACED ON FILE". */
  status: string | null;
  title: string | null;
  department: string | null;
  category: string | null;
  /** As printed: "Councillor Patricia Nolan". */
  sponsors: string[];
  history: Iqm2HistoryEntry[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’' };

/** Text of an HTML fragment: tags dropped, entities decoded, spaces collapsed. */
export function markupText(fragment: string): string {
  return fragment
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** "Dec 22, 2025 5:30 PM" or "December 22, 2025" → "2025-12-22". */
export function monthDayYear(text: string | null | undefined): string | null {
  const m = /\b([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec(text ?? '');
  const month = m && MONTHS[m[1]!.toLowerCase()];
  return m && month ? `${m[3]}-${month}-${m[2]!.padStart(2, '0')}` : null;
}

const byId = (html: string, id: string) => {
  const m = new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</(?:div|span|h1|a)>`).exec(html);
  return m ? markupText(m[1]!) || null : null;
};

/** Names in a roll-call cell ("A, B, C"); "None" and blanks are empty. */
export function splitNames(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/,|;/)
    .map((s) => s.trim())
    .filter((s) => s && !/^none$/i.test(s));
}

/** "ORDER ADOPTED [8 TO 0]" → the result and its tally. */
export function parseResult(text: string): Pick<Iqm2Vote, 'result' | 'yes' | 'no' | 'unanimous'> {
  const tally = /\[\s*(\d+)\s*(?:TO|-)\s*(\d+)(?:\s*-\s*\d+)*\s*\]/i.exec(text);
  const unanimous = /\[\s*UNANIMOUS\s*\]/i.test(text);
  return {
    result: text.replace(/\[[^\]]*\]/g, '').trim(),
    yes: tally ? Number(tally[1]) : null,
    no: tally ? Number(tally[2]) : null,
    unanimous,
  };
}

function parseVoteRecord(table: string): Iqm2Vote | null {
  const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => {
    const cells = [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => markupText(c[1]!));
    return { role: (cells[0] ?? '').replace(/:$/, '').toUpperCase(), value: cells[1] ?? '' };
  });
  const result = rows.find((r) => r.role === 'RESULT');
  if (!result) return null;
  const names = (role: string) => splitNames(rows.find((r) => r.role === role)?.value);
  return {
    ...parseResult(result.value),
    yeas: names('YEAS'),
    nays: names('NAYS'),
    absent: names('ABSENT'),
    present: names('PRESENT'),
    recused: names('RECUSED'),
  };
}

/**
 * A legislative file's public page. Throws when the page doesn't look like one
 * (no file number), so a changed layout fails the job instead of storing blanks.
 */
export function parseLegiFile(html: string, id: number): Iqm2LegiFile {
  const number = byId(html, 'ContentPlaceholder1_lblResNum');
  if (!number || !/\d/.test(number))
    throw new ShapeError('IQM2 legislative file page', [`no file number on the page for ${id}`]);
  const info = /<table id="tblLegiFileInfo"[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
  const field = (name: string) => {
    const m = new RegExp(`<strong>${name}</strong>:</th>\\s*<td>([\\s\\S]*?)</td>`).exec(info);
    return m ? markupText(m[1]!) : null;
  };
  const history: Iqm2HistoryEntry[] = [];
  const historyHtml = /class="LayoutTable MeetingHistory"([\s\S]*?)<\/table>\s*<\/div>\s*<\/div>/.exec(html)?.[1] ?? '';
  for (const part of historyHtml.split(/<tr class="HeaderRow HistorySection">/).slice(1)) {
    const link = /Detail_Meeting\.aspx\?ID=(\d+)"[^>]*>([^<]*)</.exec(part);
    const span = (cls: string) => {
      const m = new RegExp(`lblMeeting${cls}_\\d+"[^>]*>([^<]*)<`).exec(part);
      return m ? markupText(m[1]!) || null : null;
    };
    const comments = /class="Comments">([\s\S]*?)<\/div>/.exec(part);
    const record = /<table[^>]*class='VoteRecord'>([\s\S]*?)<\/table>/.exec(part);
    history.push({
      meetingId: link ? Number(link[1]) : null,
      date: monthDayYear(link?.[2]),
      body: span('Group'),
      meetingType: span('Type'),
      comments: comments ? markupText(comments[1]!) || null : null,
      vote: record ? parseVoteRecord(record[1]!) : null,
    });
  }
  return {
    id,
    fileType: byId(html, 'ContentPlaceholder1_lblLegiFileType'),
    number,
    status: byId(html, 'ContentPlaceholder1_lblStatus'),
    title: byId(html, 'ContentPlaceholder1_lblLegiFileTitle'),
    department: field('Department'),
    category: field('Category'),
    sponsors: splitNames(field('Sponsors')),
    history,
  };
}
