/**
 * The Data status page: when each source last arrived (public.data_status). Rows
 * name cities, courts and states by key; this turns them into readable labels.
 */
import { CITIES } from './cities';
import { congressLabel, stateName } from './format';
import { LOADING_BELOW, type CoverageRow, type StatusRow } from './freshness';
import { STATE_COURT_NAMES } from './state-tabs';

export type { StatusRow } from './freshness';

/** A readable label: "Boston: council items", "Massachusetts: Supreme Judicial Court decisions". */
export function statusLabel(row: Pick<StatusRow, 'name' | 'label'>): string {
  const [prefix, key] = row.name.split(':');
  if (!key) return row.label;
  if (prefix === '311') return `${CITIES[key]?.name ?? key}: 311 requests`;
  if (prefix === 'matters' || prefix === 'meetings') {
    const city = CITIES[key]?.name ?? key;
    return `${city}: council ${prefix === 'matters' ? 'items' : 'meetings'}`;
  }
  if (prefix === 'court') return `${STATE_COURT_NAMES[key] ?? key} decisions`;
  if (prefix === 'governor') return `${stateName(key)}: governor’s orders`;
  return row.label;
}

/** Problems first, then by label. */
export function sortStatus(rows: StatusRow[]): StatusRow[] {
  return [...rows].sort(
    (a, b) => Number(!a.problem) - Number(!b.problem) || statusLabel(a).localeCompare(statusLabel(b)),
  );
}

/** "Bills in the 119th Congress", "Massachusetts: state bills". */
export function coverageLabel(source: string): string {
  const [kind, key = ''] = source.split(':');
  if (kind === 'bills') return `Bills in the ${congressLabel(Number(key))}`;
  if (kind === 'state-bills') return `${stateName(key)}: state bills`;
  return source;
}

/** Sources whose records are still loading (well short of the upstream total), largest gap first. */
export function stillLoading(rows: readonly CoverageRow[]): CoverageRow[] {
  return rows
    .filter((r) => r.expected > 0 && r.held < r.expected * LOADING_BELOW)
    .sort((a, b) => b.expected - b.held - (a.expected - a.held));
}
