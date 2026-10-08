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

/**
 * The live parts of a prerendered bill page. Renders the build-time values (so
 * the page works without JavaScript), then fetches the current ones.
 */
export default function BillLive(props: Props) {
  const [live, setLive] = useState<Live>(props);
  const [checked, setChecked] = useState<'idle' | 'fresh' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, actions] = await Promise.all([
          select<Omit<Live, 'actions'>>('bills', {
            id: `eq.${props.billId}`,
            select: 'status,latest_action_date,latest_action_text',
          }),
          props.part === 'timeline'
            ? select<Action>('bill_actions', {
                bill_id: `eq.${props.billId}`,
                select: 'seq,action_date,text,chamber,source_system',
                order: 'seq.asc',
              })
            : Promise.resolve(null),
        ]);
        if (cancelled || !rows[0]) return;
        setLive((prev) => ({ ...prev, ...rows[0]!, actions: actions ?? prev.actions }));
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
