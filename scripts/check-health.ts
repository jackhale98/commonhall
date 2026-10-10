/**
 * The daily health check: prints private.sync_health() (jobs that failed, are
 * overdue or died mid-run; datasets with nothing new for longer than usual) and
 * exits 1 when there is anything, so the "Sync health" workflow fails and GitHub
 * emails the owner. Also prints failed function responses from the last hours
 * (pg_net keeps about six), for context.
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/check-health.ts
 */
import postgres from 'postgres';

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Set SUPABASE_DB_URL');
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const problems = await sql<
      { kind: string; name: string; label: string; runner: string | null; problem: string; error: string | null }[]
    >`select kind, name, label, runner, problem, error from private.sync_health()`;
    const failed = await sql<{ status_code: number | null; n: number }[]>`
      select status_code, count(*)::int as n from net._http_response
       where status_code is null or status_code not between 200 and 299
       group by status_code order by n desc`.catch(() => []);
    if (failed.length) {
      console.log('Function responses that were not 2xx (pg_net, last few hours):');
      for (const f of failed) console.log(`  ${f.status_code ?? 'no response'}: ${f.n}`);
    }
    if (!problems.length) {
      console.log('All jobs and datasets are healthy.');
      return;
    }
    console.log(`${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
    for (const p of problems) {
      console.log(`- [${p.kind}] ${p.label} (${p.name}): ${p.problem}${p.runner ? ` — runs in ${p.runner}` : ''}`);
      if (p.error) console.log(`    ${p.error}`);
    }
    // A GitHub Actions summary, so the failure email links straight to the list.
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        ['| Kind | What | Problem | Runs in |', '|---|---|---|---|']
          .concat(problems.map((p) => `| ${p.kind} | ${p.label} | ${p.problem} | ${p.runner ?? ''} |`))
          .join('\n') + '\n',
      );
    }
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
