/**
 * Worcester's capital and operating budgets into `local_capital_*` and
 * `local_operating_*`, from the city's open data site, where each year's budget is
 * posted as a PDF ("Fiscal Year 2027 Annual Capital Budget (Proposed)", "… Annual
 * Operating Budget …"). Loads the newest two capital budgets and the newest operating
 * budget (only its revenue and spending summary tables), preferring the adopted budget
 * to the proposal for a year; skips a document already loaded under the same title, and
 * refuses one whose lines don't add up to its printed totals. The parsing is in
 * ../local/worcester-budget.ts. Run by scripts/load-worcester-budget.ts ("Load Worcester
 * budget").
 */
import type { HttpClient } from '@civic/congress-client';
import type { Sql } from '../db.ts';
import {
  parseCapitalBudget,
  parseOperatingSummary,
  subtotalMismatches,
  type ParsedCapitalBudget,
  type ParsedOperatingSummary,
} from '../local/worcester-budget.ts';
import type { PdfText } from './pdf.ts';

const HUB = 'https://opendata.worcesterma.gov/api/search/v1/collections/all/items';
const CITY = 'ma-worcester';

export interface WorcesterBudgetDocument {
  kind: 'capital' | 'operating';
  id: string;
  title: string;
  fiscalYear: number;
  stage: 'proposed' | 'adopted';
  url: string;
}

/** The open data site's search for one kind of budget. */
export function worcesterBudgetSearchUrl(kind: WorcesterBudgetDocument['kind']): string {
  return `${HUB}?q=${encodeURIComponent(`annual ${kind} budget`)}&limit=50`;
}

/** "Fiscal Year 2027 Annual Capital Budget (Proposed)" → capital, 2027, proposed. */
export function budgetDocument(id: string, title: string): WorcesterBudgetDocument | null {
  const m = /^Fiscal Year (\d{4}) Annual (Capital|Operating) Budget(.*)$/i.exec(title.trim());
  if (!m) return null;
  return {
    kind: m[2]!.toLowerCase() === 'capital' ? 'capital' : 'operating',
    id,
    title: title.trim(),
    fiscalYear: Number(m[1]),
    stage: /proposed|recommended/i.test(m[3]!) ? 'proposed' : 'adopted',
    url: `https://www.arcgis.com/sharing/rest/content/items/${id}/data`,
  };
}

/** The newest fiscal years (two for capital, one for operating); adopted when there is one, else the proposal. */
export function pickDocuments(docs: WorcesterBudgetDocument[], count = 2): WorcesterBudgetDocument[] {
  const years = [...new Set(docs.map((d) => d.fiscalYear))].sort((a, b) => b - a).slice(0, count);
  return years.map(
    (y) => docs.find((d) => d.fiscalYear === y && d.stage === 'adopted') ?? docs.find((d) => d.fiscalYear === y)!,
  );
}

export interface WorcesterBudgetOptions {
  http: Pick<HttpClient, 'get'>;
  pdfText: PdfText;
  /** Reload documents already loaded. */
  force?: boolean;
  /** Load this one capital budget PDF instead of searching the site (and skip the operating budget). */
  file?: { pdf: Uint8Array; fiscalYear: number; stage: WorcesterBudgetDocument['stage']; path: string };
  log?: (message: string) => void;
}

async function listDocuments(
  http: Pick<HttpClient, 'get'>,
  kind: WorcesterBudgetDocument['kind'],
): Promise<WorcesterBudgetDocument[]> {
  const response = await http.get(worcesterBudgetSearchUrl(kind), 'application/json');
  const body = (await response.json()) as { features: { id: string; properties: { title: string } }[] };
  return body.features
    .map((f) => budgetDocument(f.id, f.properties.title))
    .filter((d) => d !== null && d.kind === kind) as WorcesterBudgetDocument[];
}

async function fetchPdf(http: Pick<HttpClient, 'get'>, url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await http.get(url, 'application/pdf')).arrayBuffer());
}

const aboutUrl = (doc: WorcesterBudgetDocument) => `https://opendata.worcesterma.gov/documents/${doc.id}/about`;

async function writeCapital(sql: Sql, doc: WorcesterBudgetDocument, parsed: ParsedCapitalBudget) {
  await sql.begin(async (tx) => {
    await tx`delete from public.local_capital_items where city = ${CITY} and fiscal_year = ${doc.fiscalYear}`;
    await tx`delete from public.local_capital_documents where city = ${CITY} and fiscal_year = ${doc.fiscalYear}`;
    await tx`
      insert into public.local_capital_items ${tx(
        parsed.items.map((i) => ({ city: CITY, fiscal_year: doc.fiscalYear, stage: doc.stage, ...i })) as never,
      )}`;
    await tx`
      insert into public.local_capital_documents (city, fiscal_year, stage, title, source_url, plan_years, plan)
      values (${CITY}, ${doc.fiscalYear}, ${doc.stage}, ${doc.title}, ${aboutUrl(doc)},
              ${parsed.planYears}, ${tx.json(parsed.plan as never)})`;
  });
}

async function writeOperating(sql: Sql, doc: WorcesterBudgetDocument, parsed: ParsedOperatingSummary) {
  await sql.begin(async (tx) => {
    await tx`delete from public.local_operating_lines where city = ${CITY}`;
    await tx`delete from public.local_operating_documents where city = ${CITY}`;
    await tx`
      insert into public.local_operating_lines ${tx(
        parsed.lines.map((l) => ({ city: CITY, fiscal_year: doc.fiscalYear, ...l })) as never,
      )}`;
    await tx`
      insert into public.local_operating_documents (city, fiscal_year, stage, title, source_url, columns)
      values (${CITY}, ${doc.fiscalYear}, ${doc.stage}, ${doc.title}, ${aboutUrl(doc)}, ${parsed.columns})`;
  });
}

/** Load any new budget documents; returns the number of documents written. */
export async function loadWorcesterBudget(sql: Sql, options: WorcesterBudgetOptions): Promise<number> {
  const { http, pdfText, force = false, file, log = () => undefined } = options;
  let written = 0;
  const docs: { doc: WorcesterBudgetDocument; pdf?: Uint8Array }[] = file
    ? [
        {
          doc: {
            kind: 'capital',
            id: 'local',
            title: `Fiscal Year ${file.fiscalYear} Annual Capital Budget`,
            fiscalYear: file.fiscalYear,
            stage: file.stage,
            url: file.path,
          },
          pdf: file.pdf,
        },
      ]
    : pickDocuments(await listDocuments(http, 'capital')).map((doc) => ({ doc }));
  for (const { doc, pdf } of docs) {
    const [have] = await sql<{ title: string; stage: string }[]>`
      select title, stage from public.local_capital_documents where city = ${CITY} and fiscal_year = ${doc.fiscalYear}`;
    if (have && have.title === doc.title && !force) {
      log(`${doc.title}: already loaded`);
      continue;
    }
    const parsed = parseCapitalBudget(pdfText(pdf ?? (await fetchPdf(http, doc.url)), { layout: true }));
    const problems = subtotalMismatches(parsed);
    if (problems.length || parsed.items.length === 0)
      throw new Error(`${doc.title} doesn't add up, so it wasn't loaded:\n  ${problems.join('\n  ')}`);
    for (const w of parsed.planWarnings) log(`${doc.title}: five-year plan as printed: ${w}`);
    await writeCapital(sql, doc, parsed);
    written++;
    const total = parsed.items.reduce((n, i) => n + i.borrowing + i.cash, 0);
    log(
      `${doc.title}: ${parsed.items.length} projects in ${parsed.subtotals.size} departments, $${total.toLocaleString()} borrowing and cash`,
    );
  }
  // The operating budget: the newest year's revenue and spending summaries.
  if (!file) {
    for (const doc of pickDocuments(await listDocuments(http, 'operating'), 1)) {
      const [have] = await sql<{ title: string }[]>`
        select title from public.local_operating_documents where city = ${CITY}`;
      if (have && have.title === doc.title && !force) {
        log(`${doc.title}: already loaded`);
        continue;
      }
      const parsed = parseOperatingSummary(pdfText(await fetchPdf(http, doc.url), { layout: true }));
      if (parsed.problems.length || parsed.lines.length === 0)
        throw new Error(`${doc.title} doesn't add up, so it wasn't loaded:\n  ${parsed.problems.join('\n  ')}`);
      await writeOperating(sql, doc, parsed);
      written++;
      const total = parsed.lines.filter((l) => l.kind === 'revenue').reduce((n, l) => n + l.amounts.at(-1)!, 0);
      log(`${doc.title}: ${parsed.lines.length} revenue and spending lines, $${total.toLocaleString()} in revenue`);
    }
  }
  return written;
}
