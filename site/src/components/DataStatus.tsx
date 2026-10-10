/**
 * The Data status list: each sync job (when it last ran cleanly) and each dataset
 * (its newest record), with anything late or failing first. Starts from the build's
 * copy and refreshes from public.data_status on load, so it is current.
 */
import { useEffect, useState } from 'preact/hooks';
import { formatDate, formatDateTime } from '../lib/format';
import { rpc } from '../lib/rest';
import { sortStatus, statusLabel, type StatusRow } from '../lib/status';

function Rows({ rows, kind }: { rows: StatusRow[]; kind: StatusRow['kind'] }) {
  return (
    <ul class="status-list">
      {sortStatus(rows.filter((r) => r.kind === kind)).map((r) => (
        <li key={r.name} class={r.problem ? 'status-row is-bad' : 'status-row'}>
          <span class="status-mark" aria-hidden="true">
            {r.problem ? '!' : '✓'}
          </span>
          <span class="status-what">
            <strong>{statusLabel(r)}</strong>
            <span class="muted small">
              {kind === 'job'
                ? r.last_ok
                  ? `Last ran cleanly ${formatDateTime(r.last_ok)}`
                  : 'No runs recorded yet'
                : r.newest
                  ? `Newest record ${formatDate(r.newest)}`
                  : 'No records yet'}
            </span>
          </span>
          <span class={r.problem ? 'status-state bad' : 'status-state'}>{r.problem ?? 'OK'}</span>
        </li>
      ))}
    </ul>
  );
}

export default function DataStatus({ initial }: { initial: StatusRow[] }) {
  const [rows, setRows] = useState(initial);
  const [live, setLive] = useState(false);
  useEffect(() => {
    rpc<StatusRow[]>('data_status', {})
      .then((r) => {
        if (Array.isArray(r) && r.length) setRows(r);
        setLive(true);
      })
      .catch(() => undefined);
  }, []);
  const problems = rows.filter((r) => r.problem).length;
  return (
    <div>
      <p class="status-summary" role="status">
        {problems ? `${problems} item${problems === 1 ? ' needs' : 's need'} attention.` : 'Everything is up to date.'}{' '}
        <span class="muted small">{live ? 'Checked just now.' : 'As of the last site build.'}</span>
      </p>
      <h2>Datasets</h2>
      <p class="muted small">
        The newest record we hold from each source. Quiet weeks are normal (recesses, summers); a source is flagged only
        when it has been quiet for much longer than usual.
      </p>
      <Rows rows={rows} kind="data" />
      <h2>Update jobs</h2>
      <p class="muted small">The scheduled jobs that read each source, and when each last finished without an error.</p>
      <Rows rows={rows} kind="job" />
    </div>
  );
}
