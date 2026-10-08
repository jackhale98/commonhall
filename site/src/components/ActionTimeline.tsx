import { formatDate } from '../lib/format';
import type { BillAction } from '../lib/types';

interface Props {
  actions: Pick<BillAction, 'seq' | 'action_date' | 'text' | 'chamber' | 'source_system'>[];
  /** Show only this many most recent actions, with a toggle for the rest. */
  initial?: number;
}

/**
 * Newest first. Congress.gov lists many actions twice (once from the chamber,
 * once from the Library of Congress); identical date+text pairs are merged.
 */
// The Library of Congress repeats chamber actions behind these prefixes.
const LOC_PREFIX =
  /^(passed\/agreed to in (house|senate)|failed of passage\/not agreed to in (house|senate)|resolving differences -- (house|senate) actions): /i;

export function dedupeActions<T extends { action_date: string | null; text: string; seq: number }>(actions: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of [...actions].sort((x, y) => y.seq - x.seq)) {
    const key = `${a.action_date}|${a.text.replace(LOC_PREFIX, '').trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export default function ActionTimeline({ actions, initial = 12 }: Props) {
  const list = dedupeActions(actions);
  if (list.length === 0) return <p class="muted">No actions recorded yet.</p>;
  const head = list.slice(0, initial);
  const rest = list.slice(initial);
  const item = (a: (typeof list)[number]) => (
    <li key={a.seq}>
      <time datetime={a.action_date ?? undefined}>{formatDate(a.action_date)}</time>
      {a.chamber && <span class="chip">{a.chamber === 'house' ? 'House' : 'Senate'}</span>}
      <p>{a.text}</p>
    </li>
  );
  return (
    <div>
      <ol class="timeline">{head.map(item)}</ol>
      {rest.length > 0 && (
        <details class="more">
          <summary>Show {rest.length} earlier actions</summary>
          <ol class="timeline">{rest.map(item)}</ol>
        </details>
      )}
    </div>
  );
}
