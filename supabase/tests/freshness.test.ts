import { afterAll, describe, expect, it } from 'vitest';
import { noteJobs } from '../../site/src/lib/freshness.ts';
import { connect } from './db.ts';

const sql = connect();
afterAll(() => sql.end());

describe('freshness notes', () => {
  it('refer only to jobs the health check knows', async () => {
    const rows = await sql<{ job: string }[]>`select job from private.job_schedule`;
    const known = new Set(rows.map((r) => r.job));
    expect(noteJobs().filter((job) => !known.has(job))).toEqual([]);
  });

  it('let anyone read the coverage (writes are checked by the RLS test)', async () => {
    await sql.begin(async (tx) => {
      await tx`set local role anon`;
      await tx`select * from public.data_coverage()`;
      await tx`select * from public.source_totals`;
    });
  });
});
