/** Executive orders and nominations as stored by sync-executive. */
export interface ExecutiveOrder {
  document_number: string;
  eo_number: number | null;
  title: string;
  president: string | null;
  president_name: string | null;
  signing_date: string | null;
  publication_date: string;
  html_url: string;
  pdf_url: string | null;
  citation: string | null;
  abstract: string | null;
  notes: string | null;
  revokes: number[];
  revoked_by: number[];
}

export const EXECUTIVE_ORDER_COLUMNS =
  'document_number,eo_number,title,president,president_name,signing_date,publication_date,html_url,pdf_url,citation,abstract,notes,revokes,revoked_by';

export type NominationStatus =
  | 'received'
  | 'in_committee'
  | 'reported'
  | 'on_calendar'
  | 'floor'
  | 'confirmed'
  | 'rejected'
  | 'withdrawn'
  | 'returned';

export interface Nomination {
  id: string;
  congress: number;
  number: number;
  part: number | null;
  citation: string;
  description: string | null;
  nominee: string | null;
  position: string | null;
  organization: string | null;
  is_military: boolean;
  received_date: string | null;
  latest_action_date: string | null;
  latest_action_text: string | null;
  status: NominationStatus;
}

export const NOMINATION_COLUMNS =
  'id,congress,number,part,citation,description,nominee,position,organization,is_military,received_date,latest_action_date,latest_action_text,status';

export const NOMINATION_STATUS: Record<NominationStatus, { label: string; tone: string; pending: boolean }> = {
  received: { label: 'Received', tone: 'fill-muted', pending: true },
  in_committee: { label: 'In committee', tone: 'fill-muted', pending: true },
  reported: { label: 'Reported by committee', tone: 'fill-sky', pending: true },
  on_calendar: { label: 'Awaiting a floor vote', tone: 'fill-present', pending: true },
  floor: { label: 'On the Senate floor', tone: 'fill-brand', pending: true },
  confirmed: { label: 'Confirmed', tone: 'fill-yea', pending: false },
  rejected: { label: 'Rejected', tone: 'fill-nay', pending: false },
  withdrawn: { label: 'Withdrawn', tone: 'fill-nv', pending: false },
  returned: { label: 'Returned to the President', tone: 'fill-nv', pending: false },
};

/** Congress.gov page for a nomination, e.g. …/nomination/119th-congress/615 (parts share a page). */
export function nominationUrl(n: Pick<Nomination, 'congress' | 'number'>): string {
  const suffix =
    n.congress % 100 >= 11 && n.congress % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n.congress % 10] ?? 'th');
  return `https://www.congress.gov/nomination/${n.congress}${suffix}-congress/${n.number}`;
}

/** One presidential term: a consecutive run of orders by one president, oldest first. */
export interface OrderTerm {
  key: string;
  president: string | null;
  name: string;
  from: string;
  to: string;
  count: number;
}

const orderDate = (o: Pick<ExecutiveOrder, 'signing_date' | 'publication_date'>) =>
  o.signing_date ?? o.publication_date;

/** Splits orders into terms (consecutive runs of one president), oldest term first. */
export function orderTerms<T extends ExecutiveOrder>(orders: T[]): { term: OrderTerm; orders: T[] }[] {
  const chronological = [...orders].sort(
    (a, b) => orderDate(a).localeCompare(orderDate(b)) || (a.eo_number ?? 0) - (b.eo_number ?? 0),
  );
  const out: { term: OrderTerm; orders: T[] }[] = [];
  for (const o of chronological) {
    const last = out[out.length - 1];
    if (last && last.term.president === o.president) {
      last.orders.push(o);
      last.term.to = orderDate(o).slice(0, 4);
      last.term.count++;
    } else {
      const year = orderDate(o).slice(0, 4);
      out.push({
        term: {
          key: `${o.president ?? 'unknown'}-${year}`,
          president: o.president,
          name: o.president_name ?? 'Unknown',
          from: year,
          to: year,
          count: 1,
        },
        orders: [o],
      });
    }
  }
  return out;
}

export const termLabel = (t: OrderTerm) => `${t.name} (${t.from === t.to ? t.from : `${t.from}–${t.to}`})`;

/** Executive order numbers each order is revoked by, from both sides' Federal Register notes. */
export function revokedByMap(orders: ExecutiveOrder[]): Map<number, number[]> {
  const map = new Map<number, Set<number>>();
  const add = (n: number, by: number) => (map.get(n) ?? map.set(n, new Set()).get(n)!).add(by);
  for (const o of orders) {
    if (!o.eo_number) continue;
    for (const n of o.revokes ?? []) add(n, o.eo_number);
    for (const n of o.revoked_by ?? []) add(o.eo_number, n);
  }
  return new Map([...map].map(([n, s]) => [n, [...s].sort((a, b) => a - b)]));
}

/** Compact order row for the executive orders explorer (orders.json). */
export interface OrderRow {
  /** Document number (page slug). */
  d: string;
  /** EO number. */
  n: number | null;
  t: string;
  /** Signing (or publication) date. */
  s: string;
  /** Term key. */
  g: string;
  /** Orders this one revokes. */
  rv?: number[];
  /** Orders that revoke this one. */
  rb?: number[];
  /** Has a discussion. */
  x?: 1;
}

/** Compact rows for every order, newest first, with each order's term and revocations. */
export function orderRows(orders: ExecutiveOrder[], hasDiscussion: (doc: string) => boolean): OrderRow[] {
  const revoked = revokedByMap(orders);
  const rows: OrderRow[] = [];
  for (const { term, orders: list } of orderTerms(orders)) {
    for (const o of list) {
      const row: OrderRow = { d: o.document_number, n: o.eo_number, t: o.title, s: orderDate(o), g: term.key };
      const rv = (o.revokes ?? []).filter(Boolean);
      const rb = o.eo_number ? revoked.get(o.eo_number) : undefined;
      if (rv.length) row.rv = rv;
      if (rb?.length) row.rb = rb;
      if (hasDiscussion(o.document_number)) row.x = 1;
      rows.push(row);
    }
  }
  return rows.reverse();
}
