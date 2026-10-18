/**
 * The daily health check: prints private.sync_health() and exits 1 on a failure,
 * so the "Sync health" workflow fails and GitHub emails the owner.
 *
 * - Failures: a job or loader that failed, is overdue, died mid-run or never ran.
 * - Warnings: a dataset with nothing new for longer than usual (a quiet source, or a
 *   council in recess). Listed and annotated, but they don't fail the run, so one
 *   quiet source doesn't keep the alert red and hide a real failure.
 *
 * Also prints failed function responses from the last hours (pg_net keeps about
 * six), for context.
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
    const failures = problems.filter((p) => p.kind === 'job');
    const warnings = problems.filter((p) => p.kind !== 'job');
    const line = (p: (typeof problems)[number]) =>
      `[${p.kind}] ${p.label} (${p.name}): ${p.problem}${p.runner ? ` — runs in ${p.runner}` : ''}`;
    if (failures.length) {
      console.log(`${failures.length} failure${failures.length === 1 ? '' : 's'}:`);
      for (const p of failures) {
        console.log(`- ${line(p)}`);
        if (p.error) console.log(`    ${p.error}`);
      }
    }
    if (warnings.length) {
      console.log(`${warnings.length} warning${warnings.length === 1 ? '' : 's'} (not failing the check):`);
      for (const p of warnings) {
        console.log(`- ${line(p)}`);
        // An annotation on the run, so warnings show without failing it.
        if (process.env.GITHUB_ACTIONS) console.log(`::warning title=${p.label}::${p.problem}`);
      }
    }
    // A GitHub Actions summary, so the failure email links straight to the list.
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        ['| Severity | Kind | What | Problem | Runs in |', '|---|---|---|---|---|']
          .concat(
            problems.map(
              (p) =>
                `| ${p.kind === 'job' ? 'failure' : 'warning'} | ${p.kind} | ${p.label} | ${p.problem} | ${p.runner ?? ''} |`,
            ),
          )
          .join('\n') + '\n',
      );
    }
    if (!failures.length) return;
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
