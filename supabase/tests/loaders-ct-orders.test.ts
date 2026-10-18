import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadCtOrders } from '@civic/sync/loaders';
import type { Sql } from '@civic/sync';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());
beforeEach(async () => {
  await sql`delete from public.state_executive_orders where state = 'CT'`;
});

const fixture = (name: string) =>
  readFileSync(new URL(`../../packages/congress-client/test/fixtures/ct-orders/${name}`, import.meta.url), 'utf8');

/** portal.ct.gov as recorded: one list page (later pages empty) and order PDFs served as their text. */
function fakeSite() {
  const pdfs: string[] = [];
  const http = {
    get: async (url: string) => {
      if (url.endsWith('.pdf') || url.includes('.pdf?')) {
        pdfs.push(url);
        return new Response(new TextEncoder().encode(url));
      }
      const page = Number(new URL(url).searchParams.get('Page') ?? '1');
      return new Response(page === 1 ? fixture('list.html') : '<html><body></body></html>');
    },
  };
  // The fake PDF holds its URL; 14F's and 26-3's are the recorded texts (26-3 is a scan), the rest are empty.
  const pdfText = (pdf: Uint8Array) => {
    const url = new TextDecoder().decode(pdf);
    if (/no-14f\.pdf/.test(url)) return fixture('eo-14f.txt');
    return /no-26-3\.pdf/.test(url) ? fixture('eo-26-3.txt') : '';
  };
  return { http, pdfText, pdfs };
}

describe('Load CT governor orders', () => {
  it('loads the list, reads each new order once, and writes nothing on a rerun', async () => {
    const site = fakeSite();
    const written = await loadCtOrders(sql, { http: site.http as never, pdfText: site.pdfText, minOrders: 5 });
    expect(written).toBe(6);
    expect(site.pdfs).toHaveLength(6);
    const rows = await sql<{ label: string; summary: string | null; governor: string | null }[]>`
      select label, summary, governor from public.state_executive_orders where state = 'CT' order by number desc`;
    expect(rows.map((r) => r.label)).toContain('26-3');
    // A clean PDF gives a short summary; a scan gives none (its title from the list stays).
    expect(rows.find((r) => r.label === '14F')!.summary).toEqual(expect.any(String));
    expect(rows.find((r) => r.label === '26-3')!.summary).toBeNull();
    expect(rows.every((r) => /Lamont/.test(r.governor ?? ''))).toBe(true);

    const again = fakeSite();
    expect(await loadCtOrders(sql, { http: again.http as never, pdfText: again.pdfText, minOrders: 5 })).toBe(0);
    expect(again.pdfs).toHaveLength(0);
  });

  it('refuses a list with too few orders (a changed page)', async () => {
    const site = fakeSite();
    await expect(loadCtOrders(sql, { http: site.http as never, pdfText: site.pdfText, minOrders: 50 })).rejects.toThrow(
      /Read only 6 orders/,
    );
    const [{ n }] =
      (await sql`select count(*)::int as n from public.state_executive_orders where state = 'CT'`) as unknown as [
        { n: number },
      ];
    expect(n).toBe(0);
  });
});
