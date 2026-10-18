import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { catchUpConstitutionRefs, syncBill } from '@civic/sync';
import { connect } from './db.ts';
import { FakeCongress, fixtureJson, syntheticBill } from './fake-congress.ts';

const sql = connect();
afterAll(() => sql.end());

beforeEach(async () => {
  await sql`truncate public.bill_actions, public.bill_cosponsors, public.bill_subjects, public.bills, public.members cascade`;
});

/** Recorded statements (Congressional Record, 2025–26) by bill. */
const statements = fixtureJson<{ bill: string; text: string }[]>('congress/authority-statements.json');
const statement = (bill: string) => statements.find((s) => s.bill === bill)!.text;
const clauses = statements.find((s) => /Clauses 3 and 18 of Article 1/.test(s.text))!.text;

describe('constitutional authority', () => {
  it('stores the provisions a House bill cites when the bill syncs, and an empty list without a statement', async () => {
    const api = new FakeCongress();
    api.addBill(syntheticBill(7001, '2026-10-02T12:00:00Z', { authorityStatement: clauses }));
    api.addBill(syntheticBill(7002, '2026-10-02T12:00:00Z'));
    await syncBill(sql, api.client(), 119, 'HR', 7001);
    await syncBill(sql, api.client(), 119, 'HR', 7002);
    const rows = await sql<{ id: string; constitution_refs: string[] }[]>`
      select id, constitution_refs from public.bills order by id`;
    expect(rows).toEqual([
      { id: '119-hr-7001', constitution_refs: ['Constitution.1.8.3', 'Constitution.1.8.18'] },
      { id: '119-hr-7002', constitution_refs: [] },
    ]);
    // Unchanged on the next sync: nothing rewritten.
    const again = await syncBill(sql, api.client(), 119, 'HR', 7001);
    expect(again.billChanged).toBe(false);
  });

  it('catches up House bills stored before the statement was read, and only those', async () => {
    const api = new FakeCongress();
    api.addBill(syntheticBill(7003, '2026-10-02T12:00:00Z', { authorityStatement: statement('H.R. 482') }));
    await syncBill(sql, api.client(), 119, 'HR', 7003);
    await sql`update public.bills set constitution_refs = null`;
    await sql`insert into public.bills (id, congress, bill_type, number, title) values ('119-s-9', 119, 's', 9, 'A Senate bill')`;

    const client = api.client();
    const result = await catchUpConstitutionRefs(sql, client, 60, () => false);
    expect(result).toEqual({ checked: 1, cited: 1 });
    const rows = await sql<{ id: string; constitution_refs: string[] | null }[]>`
      select id, constitution_refs from public.bills order by id`;
    expect(rows).toEqual([
      { id: '119-hr-7003', constitution_refs: ['Constitution.1.8'] },
      { id: '119-s-9', constitution_refs: null },
    ]);
    // Done: nothing is due on the next run.
    expect(await catchUpConstitutionRefs(sql, client, 60, () => false)).toEqual({ checked: 0, cited: 0 });

    // A bill Congress.gov no longer serves (404) counts as read, with nothing cited.
    await sql`insert into public.bills (id, congress, bill_type, number, title) values ('119-hr-9999', 119, 'hr', 9999, 'Gone')`;
    expect(await catchUpConstitutionRefs(sql, client, 60, () => false)).toEqual({ checked: 1, cited: 0 });
    const [gone] = await sql`select constitution_refs from public.bills where id = '119-hr-9999'`;
    expect(gone!.constitution_refs).toEqual([]);
  });
});
