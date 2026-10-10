import { useEffect, useState } from 'preact/hooks';
import type { BillStatus } from '@civic/congress-client/status';
import { formatDate } from '../lib/format';
import { select } from '../lib/rest';
import type { BillAction } from '../lib/types';
import ActionTimeline from './ActionTimeline';
import StatusTracker from './StatusTracker';

type Action = Pick<BillAction, 'seq' | 'action_date' | 'text' | 'chamber' | 'source_system'>;

interface Live {
  status: BillStatus;
  latest_action_date: string | null;
  latest_action_text: string | null;
  actions: Action[];
}

interface Props extends Live {
  billId: string;
  billType: string;
  /** Render only the tracker and latest action (the timeline lives elsewhere on the page). */
  part: 'summary' | 'timeline';
}

type Current = Omit<Live, 'actions'>;

/** One read of the bill's current status per page, shared by both islands (same module). */
const current = new Map<string, Promise<Current | null>>();
const currentBill = (id: string) => {
  if (!current.has(id))
    current.set(
      id,
      select<Current>('bills', { id: `eq.${id}`, select: 'status,latest_action_date,latest_action_text' }).then(
        (rows) => rows[0] ?? null,
      ),
    );
  return current.get(id)!;
};

/**
 * The live parts of a prerendered bill page. Renders the build-time values (so
 * the page works without JavaScript), then fetches the current status once; the
 * timeline re-reads the actions only when there is a newer one than the build had.
 */
export default function BillLive(props: Props) {
  const [live, setLive] = useState<Live>(props);
  const [checked, setChecked] = useState<'idle' | 'fresh' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await currentBill(props.billId);
        if (cancelled || !row) return;
        const newer = (row.latest_action_date ?? '') > (props.latest_action_date ?? '');
        const actions =
          props.part === 'timeline' && (newer || props.actions.length === 0)
            ? await select<Action>('bill_actions', {
                bill_id: `eq.${props.billId}`,
                select: 'seq,action_date,text,chamber,source_system',
                order: 'seq.asc',
              })
            : null;
        if (cancelled) return;
        setLive((prev) => ({ ...prev, ...row, actions: actions ?? prev.actions }));
        setChecked('fresh');
      } catch {
        if (!cancelled) setChecked('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.billId, props.part]);

  if (props.part === 'timeline') return <ActionTimeline actions={live.actions} />;

  return (
    <div class="bill-live">
      <StatusTracker billType={props.billType} status={live.status} />
      {live.latest_action_text && (
        <div class="latest-action" aria-live="polite">
          <h2 class="h-small">Latest action</h2>
          <p>
            <time datetime={live.latest_action_date ?? undefined}>{formatDate(live.latest_action_date)}</time>:{' '}
            {live.latest_action_text}
          </p>
        </div>
      )}
      {checked === 'error' && <p class="small muted">Couldn’t check for updates; showing data from the last build.</p>}
    </div>
  );
}
