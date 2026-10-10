import { afterAll, describe, expect, it } from 'vitest';
import { connect } from './db.ts';

const sql = connect();
afterAll(() => sql.end());

describe('trim_past_congresses', () => {
  it('keeps the history of past bills that moved, and drops it for bills left in committee', async () => {
    await sql`delete from public.bills where congress = 117`;
    await sql`
      insert into public.bills (id, congress, bill_type, number, title, status) values
        ('117-hr-9001', 117, 'hr', 9001, 'A law', 'law'),
        ('117-hr-9002', 117, 'hr', 9002, 'Never left committee', 'in_committee')`;
    await sql`
      insert into public.bill_actions (bill_id, seq, action_date, text) values
        ('117-hr-9001', 1, '2022-01-03', 'Introduced'), ('117-hr-9001', 2, '2022-06-01', 'Became Public Law'),
        ('117-hr-9002', 1, '2022-01-03', 'Introduced')`;
    await sql`select private.trim_past_congresses()`;
    const left = await sql<{ bill_id: string }[]>`
      select bill_id from public.bill_actions where bill_id like '117-%' order by bill_id, seq`;
    expect(left.map((r) => r.bill_id)).toEqual(['117-hr-9001', '117-hr-9001']);
    await sql`delete from public.bills where congress = 117`;
  });
});
