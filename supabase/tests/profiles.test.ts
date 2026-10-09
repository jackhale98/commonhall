import { afterAll, describe, expect, it } from 'vitest';
import type { Sql } from '@civic/sync';
import { asAnon, asUser, createUser } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;
afterAll(() => sql.end());

describe('saved locations', () => {
  it('never store a street address, whatever the client sends', async () => {
    const user = await createUser(sql);
    await asUser(
      sql,
      user,
      (tx) => tx`
        insert into public.profiles (user_id, address_label, state, congressional_district)
        values (${user}, '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500', 'DC', 0)`,
    );
    const [row] = await asUser(sql, user, (tx) => tx`select address_label, state from public.profiles`);
    expect(row).toEqual({ address_label: 'Washington, DC 20500', state: 'DC' });

    // An update with only a street keeps nothing rather than guess.
    await asUser(
      sql,
      user,
      (tx) => tx`update public.profiles set address_label = '123 Main St' where user_id = ${user}`,
    );
    const [after] = await asUser(sql, user, (tx) => tx`select address_label from public.profiles`);
    expect(after).toEqual({ address_label: null });

    // Nobody else can read it.
    await expect(asAnon(sql, (tx) => tx`select 1 from public.profiles`)).rejects.toThrow(/permission denied/);
    const other = await createUser(sql);
    expect(await asUser(sql, other, (tx) => tx`select 1 from public.profiles where user_id = ${user}`)).toHaveLength(0);
  });
});
