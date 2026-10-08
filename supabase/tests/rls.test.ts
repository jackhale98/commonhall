import { afterAll, describe, expect, it } from 'vitest';
import { connect } from './db.ts';

const sql = connect();
afterAll(() => sql.end());

describe('row-level security', () => {
  it('is enabled on every table in the public schema', async () => {
    const rows = await sql<{ table_name: string; rls: boolean }[]>`
      select c.relname as table_name, c.relrowsecurity as rls
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
       order by 1`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.rls).map((r) => r.table_name)).toEqual([]);
  });

  it('hides job bookkeeping from the anon role', async () => {
    await sql`insert into public.sync_state (job) values ('rls-test') on conflict do nothing`;
    const visible = await sql.begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select job from public.sync_state`;
    });
    expect(visible).toHaveLength(0);
    await sql`delete from public.sync_state where job = 'rls-test'`;
  });

  it('does not let anon call job helpers', async () => {
    const error = await sql
      .begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select public.record_api_usage('congress', 1)`;
      })
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toMatch(/permission denied/);
  });
});

describe('sync lock', () => {
  it('lets one holder in at a time and expires stale leases', async () => {
    await sql`delete from public.sync_lock where job = 'lock-test'`;
    const [a] = await sql`select public.try_sync_lock('lock-test', 'run-a', '1 minute') as ok`;
    const [b] = await sql`select public.try_sync_lock('lock-test', 'run-b', '1 minute') as ok`;
    expect([a!.ok, b!.ok]).toEqual([true, false]);

    await sql`update public.sync_lock set expires_at = now() - interval '1 second' where job = 'lock-test'`;
    const [c] = await sql`select public.try_sync_lock('lock-test', 'run-b', '1 minute') as ok`;
    expect(c!.ok).toBe(true);

    await sql`select public.release_sync_lock('lock-test', 'run-a')`; // not the holder: no-op
    const [d] = await sql`select holder from public.sync_lock where job = 'lock-test'`;
    expect(d!.holder).toBe('run-b');
    await sql`select public.release_sync_lock('lock-test', 'run-b')`;
    const [e] = await sql`select public.try_sync_lock('lock-test', 'run-a', '1 minute') as ok`;
    expect(e!.ok).toBe(true);
    await sql`delete from public.sync_lock where job = 'lock-test'`;
  });
});
