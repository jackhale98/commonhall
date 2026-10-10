/**
 * Load Worcester's capital budget from the city's open data site, where each year's
 * budget is posted as a PDF ("Fiscal Year 2027 Annual Capital Budget (Proposed)").
 * The "Load Worcester budget" workflow runs this monthly and on demand; it skips a
 * document it has already loaded.
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/load-worcester-budget.ts [--force] [--file budget.pdf --year 2027 --stage proposed]
 *
 * Needs `pdftotext` (poppler-utils). Loads the newest two fiscal years, preferring
 * the adopted budget to the proposal for a year, and refuses a document whose
 * project lines don't add up to its printed department sub-totals.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { parseCapitalBudget, subtotalMismatches, type ParsedCapitalBudget } from '@civic/sync';

const HUB = 'https://opendata.worcesterma.gov/api/search/v1/collections/all/items';
const USER_AGENT = 'commonhall (+https://github.com/jackhale98/commonhall)';
const CITY = 'worcester';

interface Document {
  id: string;
  title: string;
  fiscalYear: number;
  stage: 'proposed' | 'adopted';
  url: string;
}

/** "Fiscal Year 2027 Annual Capital Budget (Proposed)" → 2027, proposed. */
export function budgetDocument(id: string, title: string): Document | null {
  const m = /^Fiscal Year (\d{4}) Annual Capital Budget(.*)$/i.exec(title.trim());
  if (!m) return null;
  return {
    id,
    title: title.trim(),
    fiscalYear: Number(m[1]),
    stage: /proposed|recommended/i.test(m[2]!) ? 'proposed' : 'adopted',
    url: `https://www.arcgis.com/sharing/rest/content/items/${id}/data`,
  };
}

async function listDocuments(): Promise<Document[]> {
  const url = `${HUB}?q=${encodeURIComponent('annual capital budget')}&limit=50`;
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const body = (await response.json()) as { features: { id: string; properties: { title: string } }[] };
  return body.features.map((f) => budgetDocument(f.id, f.properties.title)).filter((d) => d !== null);
}

/** The newest two fiscal years; the adopted budget when there is one, else the proposal. */
export function pickDocuments(docs: Document[]): Document[] {
  const years = [...new Set(docs.map((d) => d.fiscalYear))].sort((a, b) => b - a).slice(0, 2);
  return years.map(
    (y) => docs.find((d) => d.fiscalYear === y && d.stage === 'adopted') ?? docs.find((d) => d.fiscalYear === y)!,
  );
}

function pdfText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'budget-'));
  try {
    const file = join(dir, 'budget.pdf');
    writeFileSync(file, pdf);
    return execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function write(sql: postgres.Sql, doc: Document, parsed: ParsedCapitalBudget) {
  await sql.begin(async (tx) => {
    await tx`delete from public.local_capital_items where city = ${CITY} and fiscal_year = ${doc.fiscalYear}`;
    await tx`delete from public.local_capital_documents where city = ${CITY} and fiscal_year = ${doc.fiscalYear}`;
    await tx`
      insert into public.local_capital_items ${tx(
        parsed.items.map((i) => ({ city: CITY, fiscal_year: doc.fiscalYear, stage: doc.stage, ...i })) as never,
      )}`;
    await tx`
      insert into public.local_capital_documents (city, fiscal_year, stage, title, source_url, plan_years, plan)
      values (${CITY}, ${doc.fiscalYear}, ${doc.stage}, ${doc.title},
              ${`https://opendata.worcesterma.gov/documents/${doc.id}/about`},
              ${parsed.planYears}, ${tx.json(parsed.plan as never)})`;
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      force: { type: 'boolean', default: false },
      file: { type: 'string' },
      year: { type: 'string' },
      stage: { type: 'string' },
    },
  });
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('Set SUPABASE_DB_URL');
  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const docs: { doc: Document; pdf?: Buffer }[] = values.file
      ? [
          {
            doc: {
              id: 'local',
              title: `Fiscal Year ${values.year} Annual Capital Budget`,
              fiscalYear: Number(values.year),
              stage: values.stage === 'proposed' ? 'proposed' : 'adopted',
              url: values.file,
            },
            pdf: (await import('node:fs')).readFileSync(values.file),
          },
        ]
      : pickDocuments(await listDocuments()).map((doc) => ({ doc }));
    for (const { doc, pdf } of docs) {
      const [have] = await sql<{ title: string; stage: string }[]>`
        select title, stage from public.local_capital_documents where city = ${CITY} and fiscal_year = ${doc.fiscalYear}`;
      if (have && have.title === doc.title && !values.force) {
        console.log(`${doc.title}: already loaded`);
        continue;
      }
      const bytes =
        pdf ?? Buffer.from(await (await fetch(doc.url, { headers: { 'user-agent': USER_AGENT } })).arrayBuffer());
      const parsed = parseCapitalBudget(pdfText(bytes));
      const problems = subtotalMismatches(parsed);
      if (problems.length || parsed.items.length === 0)
        throw new Error(`${doc.title} doesn't add up, so it wasn't loaded:\n  ${problems.join('\n  ')}`);
      for (const w of parsed.planWarnings) console.warn(`${doc.title}: five-year plan as printed: ${w}`);
      await write(sql, doc, parsed);
      const total = parsed.items.reduce((n, i) => n + i.borrowing + i.cash, 0);
      console.log(
        `${doc.title}: ${parsed.items.length} projects in ${parsed.subtotals.size} departments, $${total.toLocaleString()} borrowing and cash`,
      );
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
