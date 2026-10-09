import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CongressClient, FederalRegisterClient, RequestBudget, type FetchLike } from '@civic/congress-client';
import { EXECUTIVE_JOB, runJob, syncExecutive, type ExecutiveCursor, type Sql } from '@civic/sync';
import { asAnon } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../packages/congress-client/test/fixtures/${name}`, import.meta.url)), 'utf8');

/** Federal Register and Congress.gov fakes: recorded orders, the nominations sample. */
function fakes() {
  const calls: URL[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.host === 'www.federalregister.gov') {
      const body = JSON.parse(fixture('federal-register/executive-orders.json'));
      body.next_page_url = null;
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(fixture('congress/nominations-sample.json'), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

async function run(fetch: FetchLike) {
  const budget = new RequestBudget(20, 'congress');
  return runJob<ExecutiveCursor>({
    sql,
    job: EXECUTIVE_JOB,
    timeLimitMs: 60_000,
    log: () => undefined,
    run: (ctx) =>
      syncExecutive(ctx, {
        federalRegister: new FederalRegisterClient({ fetch }),
        congress: new CongressClient({ apiKey: 'test', fetch, budget, sleep: async () => undefined }),
        congressNumber: 119,
        now: new Date('2026-10-09T00:00:00Z'),
      }),
  });
}

beforeEach(async () => {
  await sql`delete from public.executive_orders`;
  await sql`delete from public.nominations`;
  await sql`delete from public.sync_state where job = ${EXECUTIVE_JOB}`;
  await sql`delete from public.sync_lock`;
});

describe('sync-executive', () => {
  it('loads orders and nominations, then asks only for updates', async () => {
    const api = fakes();
    const first = await run(api.fetch);
    expect(first.status).toBe('ok');
    const orders = await sql`select eo_number, president from public.executive_orders order by eo_number desc`;
    expect(orders.map((o) => o.eo_number)).toEqual([14434, 14433, 14432, 14431]);
    const noms = await sql`select id, status, nominee from public.nominations order by id`;
    expect(noms.map((n) => [n.id, n.status])).toEqual([
      ['119-pn373', 'confirmed'],
      ['119-pn480', 'in_committee'],
      ['119-pn501', 'confirmed'],
      ['119-pn615-2', 'confirmed'],
    ]);

    api.calls.length = 0;
    const second = await run(api.fetch);
    expect(second.rowsWritten).toBe(0);
    const fr = api.calls.find((u) => u.host === 'www.federalregister.gov')!;
    expect(fr.searchParams.get('conditions[publication_date][gte]')).toBe('2026-09-18');
    const cg = api.calls.find((u) => u.pathname === '/v3/nomination/119')!;
    expect(cg.searchParams.get('fromDateTime')).toBe('2026-10-08T23:00:00Z');
  });

  it('is public to read', async () => {
    await run(fakes().fetch);
    const rows = await asAnon(sql, (tx) => tx`select id from public.nominations`);
    expect(rows).toHaveLength(4);
    const orders = await asAnon(sql, (tx) => tx`select document_number from public.executive_orders`);
    expect(orders).toHaveLength(4);
  });
});
