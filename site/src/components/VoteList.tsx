import { formatDate } from '../lib/format';
import { voteSegments } from '../lib/charts';
import { voteHref } from '../lib/paths';
import StackedBar from './viz/StackedBar';

export interface VoteListItemData {
  id: string;
  chamber: 'house' | 'senate';
  roll_number: number;
  date: string | null;
  question: string | null;
  result: string | null;
  yea_total: number;
  nay_total: number;
  present_total?: number;
  not_voting_total?: number;
  /** A member's position, when listing one member's votes. */
  position?: 'yea' | 'nay' | 'present' | 'not_voting';
  /** What the vote was on (lib/votes.ts); left out where it is obvious (a bill's own page). */
  bill?: string | null;
  subject?: string | null;
}

const POSITION: Record<string, string> = { yea: 'Yea', nay: 'Nay', present: 'Present', not_voting: 'Did not vote' };

export default function VoteList({ votes }: { votes: VoteListItemData[] }) {
  return (
    <ul class="list vote-list">
      {votes.map((v) => (
        <li>
          <p class="meta">
            {v.chamber === 'house' ? 'House' : 'Senate'} roll call {v.roll_number} · {formatDate(v.date)}
          </p>
          <p style={{ margin: 0 }}>
            {v.position && (
              <>
                <strong class={`position-${v.position}`}>{POSITION[v.position]}</strong> ·{' '}
              </>
            )}
            <a href={voteHref(v.id)}>{v.question ?? 'Roll-call vote'}</a>{' '}
            <span class="muted">
              ({v.result ?? '—'}, {v.yea_total}–{v.nay_total})
            </span>
          </p>
          {(v.bill || v.subject) && (
            <p class="vote-about">
              {v.bill && <strong>{v.bill}</strong>}
              {v.bill && v.subject && ' · '}
              {v.subject}
            </p>
          )}
          <StackedBar size="sm" segments={voteSegments(v)} label={`${v.yea_total} yea, ${v.nay_total} nay`} />
        </li>
      ))}
    </ul>
  );
}
