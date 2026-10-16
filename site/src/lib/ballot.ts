/**
 * Ballot questions on the site: the election's name and a decided question's result.
 * The write-ups themselves are shown as the state publishes them (ballot_questions).
 */

/** "November 3, 2026 state election". */
export function electionLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const long = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return d.getUTCMonth() === 10 ? `${long} state election` : `${long} election`;
}

/** A decided question's result, once the certified counts are on file. */
export function ballotResult(q: {
  yes_count: number | null;
  no_count: number | null;
}): { passed: boolean; label: string; yesShare: number } | null {
  if (q.yes_count === null || q.no_count === null) return null;
  const total = q.yes_count + q.no_count;
  if (total === 0) return null;
  const yesShare = q.yes_count / total;
  const passed = q.yes_count > q.no_count;
  return { passed, yesShare, label: `${passed ? 'Passed' : 'Failed'}, ${Math.round(yesShare * 100)}% yes` };
}
