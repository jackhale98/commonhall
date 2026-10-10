/**
 * Connecticut governors' executive orders, as the Governor's office lists them on
 * portal.ct.gov: one list (newest first, paged with `?Page=` and `?PageSize=`) with
 * each order's date, a one-line description and a link to its signed PDF.
 *
 * Numbering: Governor Lamont's first orders ran 1, 2, … 7, 7A … 7ZZ, 7AAA … 7OOO
 * (the COVID-19 orders), 9A … 14F; since 2021 they are numbered by year ("26-3" is the
 * third order of 2026). Earlier governors' orders sit in the same list (folder
 * "others") with their own numbers, which repeat Lamont's, so only governors' own
 * folders ("lamont-executive-orders") are read.
 *
 * Plain requests work (unlike mass.gov). Many PDFs are scans: some carry no text, some
 * carry OCR text with errors. The list's description is always clean and is the
 * order's title; what it orders and why come from the PDF only when its text reads
 * cleanly (`ctOrderSummary`).
 */
import { maOrderSummary, type MaOrderSummary } from './mass-orders.ts';

export const CT_ORDERS_INDEX = 'https://portal.ct.gov/governor/governors-actions/executive-orders';

/** One page of the list. The site's own pager uses these parameters. */
export const ctOrdersPageUrl = (page: number, pageSize = 50) => `${CT_ORDERS_INDEX}?Page=${page}&PageSize=${pageSize}`;

export interface CtOrderListItem {
  /** "Executive Order No. 26-3". */
  heading: string;
  /** The office's one-line description ("Establishes the …"). */
  description: string | null;
  signed_date: string | null;
  url: string;
  /** The media folder: "lamont-executive-orders", or "others" for earlier governors. */
  folder: string | null;
}

export interface CtOrderList {
  items: CtOrderListItem[];
  /** "230 total results". */
  total: number | null;
}

export interface CtOrder {
  /** What the order is called: "26-3", "7OOO", "14F", "1". */
  label: string;
  /** A sortable number: 202603 for 26-3, 767 for 7OOO (see ctOrderNumber). */
  number: number;
  title: string;
  signed_date: string | null;
  governor: string | null;
  url: string;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&#x27;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "4/16/2026" → "2026-04-16". */
function isoDate(us: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(us.trim());
  return m ? `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null;
}

/** The list page's orders, in page order. */
export function parseCtOrderList(html: string): CtOrderList {
  const items: CtOrderListItem[] = [];
  for (const [article] of html.matchAll(/<article\b[^>]*press-rel__item[\s\S]*?<\/article>/g)) {
    const date = /press-rel__date[^>]*>([\s\S]*?)<\/div>/.exec(article)?.[1];
    const link = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(article);
    if (!link) continue;
    const desc = /press-rel__desc[^>]*>([\s\S]*?)<\/div>/.exec(article)?.[1];
    const url = link[1]!.replace(/&amp;/g, '&');
    items.push({
      heading: decode(link[2]!),
      description: desc ? decode(desc) || null : null,
      signed_date: date ? isoDate(decode(date)) : null,
      url,
      folder: /\/executive-orders\/([^/]+)\/[^/]+$/.exec(new URL(url, CT_ORDERS_INDEX).pathname)?.[1] ?? null,
    });
  }
  const total = /([\d,]+)\s+total results/i.exec(html)?.[1];
  return { items, total: total ? Number(total.replace(/,/g, '')) : null };
}

/** "Executive Order No. 26-3" → "26-3"; "Executive Order No 7KK" → "7KK". */
export function ctOrderLabel(heading: string): string | null {
  const m = /Executive Order No\.?\s*(\d{1,2}-\d{1,2}|\d{1,3}[A-Za-z]{0,3})\b/i.exec(heading);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * A sortable integer for an order's label: year-numbered orders as YYYY×100 + n
 * ("26-3" → 202603); the early series as base×100 + letters, where A…Z are 1…26, AA…ZZ
 * 27…52 and AAA…ZZZ 53…78 ("7" → 700, "7A" → 701, "7OOO" → 767, "14F" → 1406). Null
 * for a label outside both patterns.
 */
export function ctOrderNumber(label: string): number | null {
  const year = /^(\d{2})-(\d{1,2})$/.exec(label);
  if (year) return (2000 + Number(year[1])) * 100 + Number(year[2]);
  const early = /^(\d{1,3})([A-Z]*)$/.exec(label.toUpperCase());
  if (!early) return null;
  const letters = early[2]!;
  if (letters.length > 3 || (letters && !new RegExp(`^${letters[0]}+$`).test(letters))) return null;
  const index = letters ? (letters.length - 1) * 26 + (letters.charCodeAt(0) - 64) : 0;
  return Number(early[1]) * 100 + index;
}

/** Governors by their folder on portal.ct.gov. */
const GOVERNORS: Record<string, string> = { lamont: 'Ned Lamont' };

/** "lamont-executive-orders" → "Ned Lamont"; an unknown folder gives its surname. */
export function ctGovernor(folder: string | null): string | null {
  const name = /^([a-z]+)-executive-orders$/.exec(folder ?? '')?.[1];
  if (!name) return null;
  return GOVERNORS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The orders a governor's own folder holds, with labels and sortable numbers. Earlier
 * governors' orders ("others") are left out: their numbers repeat. `skipped` counts
 * items in a governor's folder whose heading didn't read as an order number.
 */
export function ctOrders(items: CtOrderListItem[]): { orders: CtOrder[]; skipped: CtOrderListItem[] } {
  const orders: CtOrder[] = [];
  const skipped: CtOrderListItem[] = [];
  for (const item of items) {
    const governor = ctGovernor(item.folder);
    if (!governor) continue;
    const label = ctOrderLabel(item.heading);
    const number = label ? ctOrderNumber(label) : null;
    if (!label || number === null) {
      skipped.push(item);
      continue;
    }
    orders.push({
      label,
      number,
      title: item.description ?? `Executive Order No. ${label}`,
      signed_date: item.signed_date,
      governor,
      url: item.url,
    });
  }
  return { orders, skipped };
}

/**
 * Whether PDF text reads cleanly enough to quote: OCR of a scan often puts digits
 * inside words ("inf01med", "Com1ecticut") or stray marks. Scans without OCR give
 * (almost) no text.
 */
export function ctTextIsClean(text: string): boolean {
  if (text.replace(/\s+/g, '').length < 200) return false;
  const words = text.match(/[A-Za-z0-9·~]+/g) ?? [];
  const bad = words.filter((w) => /[a-z][0-9]+[a-z]/.test(w) || /[·~]/.test(w)).length;
  return bad <= 1;
}

/**
 * An order's text from `pdftotext` (no layout), as paragraphs separated by blank
 * lines: the WHEREAS clauses, the NOW, THEREFORE clause and each numbered item (1. or
 * I.; its number dropped, its lettered sub-items kept with it), up to "Dated at Hartford". A paragraph starts only at one
 * of those: the PDFs' blank lines are page breaks, often mid-sentence.
 */
export function ctOrderBody(text: string): string | null {
  const lines = text.replace(/\r/g, '').replace(/\f/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^\s*(WHEREAS\b|NOW,? THEREFORE\b)/.test(l));
  if (start < 0) return null;
  const paras: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) paras.push(current.trim());
    current = '';
  };
  for (const raw of lines.slice(start)) {
    const line = raw.trim();
    if (/^(Dated at|Given at|By His Excellency)/i.test(line)) break;
    // Blank lines and page numbers come from page breaks, often mid-sentence.
    if (!line || /^\d{1,2}$/.test(line)) continue;
    // A number on a line of its own ("I.") starts an item.
    if (/^(\d{1,2}|[IVX]{1,4})\.$/.test(line)) {
      flush();
      continue;
    }
    // Lettered sub-items ("a. …") stay with their numbered item.
    if (/^(WHEREAS\b|NOW,? THEREFORE\b|(\d{1,2}|[IVX]{1,4})\.\s)/.test(line)) flush();
    const item = line.replace(/^(\d{1,2}|[IVX]{1,4})\.\s+/, '');
    current = current.endsWith('-') && /^[a-z]/.test(item) ? current + item : current ? `${current} ${item}` : item;
    // "… do hereby ORDER AND DIRECT:" ends the NOW, THEREFORE clause.
    if (/^NOW,? THEREFORE\b/.test(current) && /:$/.test(line)) flush();
  }
  flush();
  return paras.length ? paras.join('\n\n') : null;
}

/**
 * What an order does and why, from its PDF text, in its own words (as for
 * Massachusetts: the opening of what it orders, about 280 characters, and the first
 * WHEREAS clause, about 200). Both null when the text is missing or reads like OCR.
 */
export function ctOrderSummary(text: string): MaOrderSummary {
  const body = ctTextIsClean(text) ? ctOrderBody(text) : null;
  return body ? maOrderSummary(body) : { summary: null, reason: null };
}
