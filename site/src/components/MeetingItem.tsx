import { formatDateTime } from '../lib/format';
import { KIND_FILL, type MeetingKind } from '../lib/meetings';

export interface MeetingRow {
  id: string;
  date: string | null;
  title: string | null;
  kind: MeetingKind;
  type: string | null;
  status: string | null;
  location: string | null;
  committees: string[];
  committeeNames: string[];
  witnesses: string[];
  video: string | null;
  url: string;
}

/** One hearing or markup in a list. */
export default function MeetingItem({ m, hideCommittees = false }: { m: MeetingRow; hideCommittees?: boolean }) {
  const off = /cancel|postpon/i.test(m.status ?? '');
  return (
    <li class={off ? 'meeting is-off' : 'meeting'}>
      <p class="meta">
        <span class={`swatch ${KIND_FILL[m.kind]}`} aria-hidden="true" />
        {m.type ?? 'Meeting'} · {formatDateTime(m.date)}
        {m.status && m.status !== 'Scheduled' && <span class="chip">{m.status}</span>}
      </p>
      <p class="meeting-title">
        <a href={m.url} rel="noopener">
          {m.title ?? 'Committee meeting'}
        </a>
      </p>
      <p class="small muted">
        {!hideCommittees && m.committeeNames.length > 0 && <>{m.committeeNames.join(', ')} · </>}
        {m.location}
        {m.witnesses.length > 0 && (
          <>
            {' '}
            · {m.witnesses.length} witness{m.witnesses.length > 1 ? 'es' : ''}
          </>
        )}
        {m.video && (
          <>
            {' '}
            ·{' '}
            <a href={m.video} rel="noopener">
              Video
            </a>
          </>
        )}
      </p>
    </li>
  );
}
