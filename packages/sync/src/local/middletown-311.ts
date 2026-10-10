/**
 * Middletown, Connecticut's 311-style requests from SeeClickFix (place
 * "middletown", Middletown CT). Each morning the job reads the issues opened in the
 * last REPORT_311_DAYS (about 40 a month, a page or two), counts them in memory by
 * day and request type, and stores only the finished report (report-311.ts), as
 * Boston's does (§97). No issue, address or description is stored. Middletown elects
 * its council citywide, so the report has no districts, and SeeClickFix has no
 * deadlines, so it doesn't claim any requests closed on time.
 */
import { REPORT_311_DAYS, issuesToDays, report311, type SeeClickFixClient } from '@civic/congress-client';
import type { JobRun } from '../job.ts';
import { addDays, bostonToday, storeReport311 } from './boston-311.ts';

export const MIDDLETOWN_311_JOB = 'middletown-311';
export const MIDDLETOWN = 'ct-middletown';
/** SeeClickFix's place for Middletown, Connecticut. */
export const MIDDLETOWN_SEECLICKFIX_PLACE = 'middletown';

export async function syncMiddletown311(
  run: JobRun<Record<string, unknown>>,
  options: { client: SeeClickFixClient; now?: () => Date },
): Promise<Record<string, unknown>> {
  // Eastern time, like Boston's: the town's own days.
  const today = bostonToday(options.now?.() ?? new Date());
  const oldest = addDays(today, -REPORT_311_DAYS);
  const issues = await options.client.issues(MIDDLETOWN_SEECLICKFIX_PLACE, `${oldest}T00:00:00-05:00`);
  // Today is still going; the report ends with yesterday.
  const days = issuesToDays(issues).filter((d) => d.day >= oldest && d.day < today);
  const report = report311(days, { districts: 0, onTime: false });
  if (!report || report.city.opened === 0)
    throw new Error('Middletown 311: no SeeClickFix issues came back for the last month');
  run.rowsWritten += await storeReport311(run.sql, MIDDLETOWN, report);
  run.log('middletown-311', {
    issues: issues.length,
    from: report.from,
    to: report.to,
    opened: report.city.opened,
    changed: run.rowsWritten,
  });
  return {};
}
