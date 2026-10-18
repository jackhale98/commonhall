import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpClient } from '@civic/congress-client';
import { loadWorcesterBudget, type PdfTextOptions } from '@civic/sync/loaders';
import type { Sql } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
const clean = async () => {
  await sql`delete from public.local_capital_items where city = 'ma-worcester' and fiscal_year in (2026, 2027)`;
  await sql`delete from public.local_capital_documents where city = 'ma-worcester' and fiscal_year in (2026, 2027)`;
  await sql`delete from public.local_operating_lines where city = 'ma-worcester' and fiscal_year in (2026, 2027)`;
  await sql`delete from public.local_operating_documents where city = 'ma-worcester' and fiscal_year in (2026, 2027)`;
};
beforeEach(clean);
afterAll(async () => {
  await clean();
  await sql.end();
});

/** The PDFs' text (pdftotext -layout), as recorded for the parser tests. */
const fixture = (name: string) =>
  readFileSync(new URL(`../../packages/sync/test/fixtures/worcester/${name}`, import.meta.url), 'utf8');

/** The open data site's search results, by document id; each "PDF" holds its id and reads as the recorded text. */
const DOCUMENTS = [
  { id: 'cap27p', title: 'Fiscal Year 2027 Annual Capital Budget (Proposed)', text: 'fy27-capital-proposed.txt' },
  { id: 'cap26a', title: 'Fiscal Year 2026 Annual Capital Budget', text: 'fy26-capital-adopted.txt' },
  { id: 'cap26p', title: 'Fiscal Year 2026 Annual Capital Budget (Proposed)', text: 'fy26-capital-adopted.txt' },
  { id: 'cap25a', title: 'Fiscal Year 2025 Annual Capital Budget', text: 'fy26-capital-adopted.txt' },
  {
    id: 'op27p',
    title: 'Fiscal Year 2027 Annual Operating Budget (Recommended)',
    text: 'fy27-operating-proposed-summary.txt',
  },
  { id: 'op26a', title: 'Fiscal Year 2026 Annual Operating Budget', text: 'fy26-operating-adopted-summary.txt' },
  { id: 'other', title: 'Capital Budget Hearing Slides', text: '' },
];

/** The real HttpClient (status checks, retries) over a fake site; `status` overrides a PDF's response. */
function fakeSite(options: { status?: number; text?: (id: string) => string } = {}) {
  const pdfs: string[] = [];
  const fetch = async (url: string) => {
    const pdf = /\/items\/(\w+)\/data$/.exec(url);
    if (pdf) {
      pdfs.push(pdf[1]!);
      if (options.status) return new Response('Not here', { status: options.status });
      return new Response(new TextEncoder().encode(pdf[1]!));
    }
    const q = new URL(url).searchParams.get('q') ?? '';
    const kind = /capital/.test(q) ? 'Capital' : 'Operating';
    return Response.json({
      features: DOCUMENTS.filter((d) => d.title.includes(kind) || d.id === 'other').map((d) => ({
        id: d.id,
        properties: { title: d.title },
      })),
    });
  };
  const http = new HttpClient({ fetch, maxAttempts: 2, sleep: async () => undefined });
  const layouts: (boolean | undefined)[] = [];
  const pdfText = (bytes: Uint8Array, opts?: PdfTextOptions) => {
    layouts.push(opts?.layout);
    const id = new TextDecoder().decode(bytes);
    if (options.text) return options.text(id);
    return fixture(DOCUMENTS.find((d) => d.id === id)!.text);
  };
  return { http, pdfText, pdfs, layouts };
}

const count = async (table: 'local_capital_items' | 'local_operating_lines') =>
  (
    (await sql`select count(*)::int as n from ${sql(`public.${table}`)} where city = 'ma-worcester'`) as unknown as [
      { n: number },
    ]
  )[0].n;

describe('Load Worcester budget', () => {
  it('loads the newest two capital budgets and the newest operating budget, and skips them on a rerun', async () => {
    const site = fakeSite();
    expect(await loadWorcesterBudget(sql, { http: site.http, pdfText: site.pdfText })).toBe(3);
    // FY27 has only a proposal; FY26's adopted budget wins over its proposal; FY25 is too old.
    expect(site.pdfs).toEqual(['cap27p', 'cap26a', 'op27p']);
    expect(site.layouts).toEqual([true, true, true]);

    const docs = await sql<{ fiscal_year: number; stage: string; title: string; source_url: string }[]>`
      select fiscal_year, stage, title, source_url from public.local_capital_documents
       where city = 'ma-worcester' order by fiscal_year`;
    expect(docs).toEqual([
      {
        fiscal_year: 2026,
        stage: 'adopted',
        title: 'Fiscal Year 2026 Annual Capital Budget',
        source_url: 'https://opendata.worcesterma.gov/documents/cap26a/about',
      },
      {
        fiscal_year: 2027,
        stage: 'proposed',
        title: 'Fiscal Year 2027 Annual Capital Budget (Proposed)',
        source_url: 'https://opendata.worcesterma.gov/documents/cap27p/about',
      },
    ]);
    const items = await sql<{ fiscal_year: number; n: number }[]>`
      select fiscal_year, count(*)::int as n from public.local_capital_items
       where city = 'ma-worcester' group by fiscal_year order by fiscal_year`;
    expect(items).toEqual([
      { fiscal_year: 2026, n: 82 },
      { fiscal_year: 2027, n: 78 },
    ]);
    const [snow] = await sql<{ borrowing: string; cash: string; stage: string }[]>`
      select borrowing, cash, stage from public.local_capital_items
       where city = 'ma-worcester' and fiscal_year = 2027 and title = 'Snow Equipment'`;
    expect(snow).toEqual({ borrowing: '0', cash: '1000000', stage: 'proposed' });
    const [op] = await sql<{ fiscal_year: number; stage: string; columns: string[] }[]>`
      select fiscal_year, stage, columns from public.local_operating_documents where city = 'ma-worcester'`;
    expect(op).toEqual({
      fiscal_year: 2027,
      stage: 'proposed',
      columns: ['FY25 Actuals', 'FY26 Budget', 'FY27 Budget'],
    });
    expect(await count('local_operating_lines')).toBeGreaterThan(0);

    // A quiet rerun reads the search results only.
    const again = fakeSite();
    expect(await loadWorcesterBudget(sql, { http: again.http, pdfText: again.pdfText })).toBe(0);
    expect(again.pdfs).toEqual([]);

    // --force reads and writes them all again, with the same rows.
    const forced = fakeSite();
    expect(await loadWorcesterBudget(sql, { http: forced.http, pdfText: forced.pdfText, force: true })).toBe(3);
    expect(forced.pdfs).toEqual(['cap27p', 'cap26a', 'op27p']);
    expect(await count('local_capital_items')).toBe(160);
  });

  it('fails on a PDF the site refuses, rather than reading an error page as an empty budget', async () => {
    const site = fakeSite({ status: 404 });
    await expect(loadWorcesterBudget(sql, { http: site.http, pdfText: site.pdfText })).rejects.toThrow(/HTTP 404/);
    expect(site.pdfs).toEqual(['cap27p']);
    expect(await count('local_capital_items')).toBe(0);
  });

  it('refuses a budget with no projects, or whose lines don’t add up to its sub-totals', async () => {
    const empty = fakeSite({ text: () => '' });
    await expect(loadWorcesterBudget(sql, { http: empty.http, pdfText: empty.pdfText })).rejects.toThrow(
      /Fiscal Year 2027 Annual Capital Budget \(Proposed\) doesn't add up/,
    );
    // One project's borrowing changed, so the Fire department no longer adds up.
    const altered = fakeSite({
      text: (id) => fixture(DOCUMENTS.find((d) => d.id === id)!.text).replace('360,000', '361,000'),
    });
    await expect(loadWorcesterBudget(sql, { http: altered.http, pdfText: altered.pdfText })).rejects.toThrow(
      /doesn't add up/,
    );
    expect(await count('local_capital_items')).toBe(0);
  });

  it('loads one local capital budget PDF and leaves the operating budget alone', async () => {
    const site = fakeSite();
    const file = {
      pdf: new TextEncoder().encode('cap27p'),
      fiscalYear: 2027,
      stage: 'adopted' as const,
      path: 'b.pdf',
    };
    expect(await loadWorcesterBudget(sql, { http: site.http, pdfText: site.pdfText, file })).toBe(1);
    expect(site.pdfs).toEqual([]);
    const [doc] = await sql<{ title: string; stage: string }[]>`
      select title, stage from public.local_capital_documents where city = 'ma-worcester' and fiscal_year = 2027`;
    expect(doc).toEqual({ title: 'Fiscal Year 2027 Annual Capital Budget', stage: 'adopted' });
    expect(await count('local_operating_lines')).toBe(0);
  });
});
