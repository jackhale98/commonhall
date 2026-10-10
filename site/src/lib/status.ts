/**
 * The Data status page: when each source last arrived (public.data_status). Rows
 * name cities, courts and states by key; this turns them into readable labels.
 */
import { CITIES } from './cities';
import { stateName } from './format';
import { STATE_COURT_NAMES } from './state-tabs';

export interface StatusRow {
  kind: 'job' | 'data';
  name: string;
  label: string;
  last_ok: string | null;
  newest: string | null;
  problem: string | null;
}

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
