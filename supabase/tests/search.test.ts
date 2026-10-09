import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from '@civic/sync';
import { asAnon } from './auth.ts';
import { connect } from './db.ts';

const sql = connect() as unknown as Sql;

const BILLS = [
  ['119-hr-90677', 'hr', 90677, 'EARA', 'Expedited Appeals Review Act', null, '2026-09-30'],
  [
    '119-hr-90184',
    'hr',
    90184,
    'Action Versus No Action Act',
    'To limit environmental review.',
    'An EA (environmental assessment) is limited.',
    '2026-09-15',
  ],
  [
    '119-hr-90224',
    'hr',
    90224,
    'Disabled Veterans Housing Support Act',
    'To help disabled veterans with housing.',
    null,
    '2026-08-01',
  ],
  ['119-hr-90227', 'hr', 90227, 'Clergy Act', 'To let clergy opt back in to Social Security.', null, '2026-09-30'],
  ['119-hr-90687', 'hr', 90687, 'CLEAN Act', 'To clean up things.', null, '2026-07-01'],
] as const;

beforeAll(async () => {
  for (const [id, type, number, short, title, summary, date] of BILLS) {
    await sql`insert into public.bills (id, congress, bill_type, number, short_title, title, summary_text, latest_action_date)
              values (${id}, 119, ${type}, ${number}, ${short}, ${title}, ${summary}, ${date})
              on conflict (id) do nothing`;
  }
});
afterAll(async () => {
  await sql`delete from public.bills where id = any(${BILLS.map((b) => b[0])}::text[])`;
  await sql.end();
});

const search = async (q: string) =>
  (await asAnon(sql, (tx) => tx`select id from public.search_bills(${q}, 20)`)).map((r) => r.id as string);

describe('search_bills', () => {
  it('matches word prefixes in titles before summary mentions', async () => {
    const ids = await search('EA');
    expect(ids).toContain('119-hr-90677');
    expect(ids.indexOf('119-hr-90677')).toBeLessThan(ids.indexOf('119-hr-90184'));
    expect((await search('EARA'))[0]).toBe('119-hr-90677');
    expect((await search('expedited appeals'))[0]).toBe('119-hr-90677');
  });

  it('treats a bill number as a lookup', async () => {
    expect(await search('H.R. 90677')).toEqual(['119-hr-90677']);
    expect(await search('hr90677')).toEqual(['119-hr-90677']);
    expect(await search('s 99999')).toEqual([]);
  });

  it('falls back to similar spellings only when nothing matches', async () => {
    expect(await search('vetrans housng')).toContain('119-hr-90224');
    const clergy = await search('clergy act');
    expect(clergy[0]).toBe('119-hr-90227');
    expect(clergy).not.toContain('119-hr-90687');
    expect(await search('xyzzyq')).toEqual([]);
  });

  it('accepts punctuation and empty input', async () => {
    expect(await search('   ')).toEqual([]);
    expect(await search('"clergy" & | !')).toContain('119-hr-90227');
  });
});
