import { useEffect, useState } from 'preact/hooks';
import { formatDate } from '../lib/format';
import { stateLegislatorHref } from '../lib/paths';
import { select } from '../lib/rest';
import { chamberLabel } from '../lib/state-people';

interface Action {
  seq: number;
  action_date: string | null;
  description: string;
  chamber: string | null;
}

interface Vote {
  id: string;
  vote_date: string | null;
  motion: string | null;
  result: string | null;
  chamber: string | null;
  yes: number;
  no: number;
  other: number;
}

interface Position {
  person_id: string | null;
  name: string;
  option: string;
}

const FIRST_ACTIONS = 6;

/**
 * A state bill’s summary, topics, history and roll calls, read live (first-class states,
 * Massachusetts and Connecticut, keep these; other states show only their topics).
 */
export default function StateBillDetail({ billId, state }: { billId: string; state: string }) {
  const [about, setAbout] = useState<{ abstract: string | null; subjects: string[] } | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [allActions, setAllActions] = useState(false);

  useEffect(() => {
    Promise.all([
      select<{ abstract: string | null; subjects: string[] }>('state_bills', {
        id: `eq.${billId}`,
        select: 'abstract,subjects',
      }),
      select<Action>('state_bill_actions', {
        bill_id: `eq.${billId}`,
        select: 'seq,action_date,description,chamber',
        order: 'seq',
      }),
      select<Vote>('state_votes', {
        bill_id: `eq.${billId}`,
        select: 'id,vote_date,motion,result,chamber,yes,no,other',
        order: 'vote_date.desc',
      }),
    ])
      .then(([[row], a, v]) => {
        setAbout(row ?? null);
        setActions(a);
        setVotes(v);
      })
      .catch(() => undefined);
  }, [billId]);

  const shown = allActions ? actions : actions.slice(-FIRST_ACTIONS);
  return (
    <>
      {about?.abstract && (
        <section class="bill-abstract" aria-labelledby="abstract-h">
          <h2 id="abstract-h" class="h-small">
            Summary
          </h2>
          <p>{about.abstract}</p>
        </section>
      )}
      {about && about.subjects.length > 0 && (
        <p class="meta">
          Topics:{' '}
          {about.subjects.map((t, i) => (
            <>
              {i > 0 && ', '}
              {t}
            </>
          ))}
        </p>
      )}
      {votes.length > 0 && (
        <section aria-labelledby="state-votes-h">
          <h2 id="state-votes-h" class="h-small">
            Roll-call votes
          </h2>
          <ul class="plain-rows">
            {votes.map((v) => (
              <VoteRow vote={v} state={state} />
            ))}
          </ul>
        </section>
      )}
      {actions.length > 0 && (
        <section aria-labelledby="history-h">
          <h2 id="history-h" class="h-small">
            History
          </h2>
          {actions.length > FIRST_ACTIONS && !allActions && (
            <button type="button" class="link-button" onClick={() => setAllActions(true)}>
              Show all {actions.length} steps
            </button>
          )}
          <ol class="bill-history">
            {shown.map((a) => (
              <li>
                <span class="small muted">
                  {formatDate(a.action_date)}
                  {a.chamber && ` · ${chamberLabel(state, a.chamber)}`}
                </span>
                <span>{a.description}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

const OPTION_LABEL: Record<string, string> = { yes: 'Yes', no: 'No' };

/** One roll call; opening it loads how each legislator voted. */
function VoteRow({ vote, state }: { vote: Vote; state: string }) {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const load = (e: Event) => {
    if (!(e.currentTarget as HTMLDetailsElement).open || positions) return;
    select<Position>('state_vote_positions', {
      vote_id: `eq.${vote.id}`,
      select: 'person_id,name,option',
      order: 'name',
    })
      .then(setPositions)
      .catch(() => setPositions([]));
  };
  const groups = new Map<string, Position[]>();
  for (const p of positions ?? []) {
    const k = OPTION_LABEL[p.option] ?? 'Did not vote yes or no';
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return (
    <li>
      <details onToggle={load}>
        <summary>
          <strong>{vote.motion || 'Roll call'}</strong>{' '}
          <span class="small muted">
            {formatDate(vote.vote_date)}
            {vote.chamber && ` · ${chamberLabel(state, vote.chamber)}`} · Yes {vote.yes}, No {vote.no}
            {vote.other > 0 && `, other ${vote.other}`}
            {vote.result && ` · ${vote.result === 'pass' ? 'passed' : vote.result === 'fail' ? 'failed' : vote.result}`}
          </span>
        </summary>
        {positions === null ? (
          <p class="small muted">Loading…</p>
        ) : positions.length === 0 ? (
          <p class="small muted">No member-by-member record for this vote.</p>
        ) : (
          [...groups.entries()].map(([label, list]) => (
            <p class="small">
              <strong>
                {label} ({list.length}):
              </strong>{' '}
              {list.map((p, i) => (
                <>
                  {i > 0 && ', '}
                  {p.person_id ? <a href={stateLegislatorHref(p.person_id)}>{p.name}</a> : p.name}
                </>
              ))}
            </p>
          ))
        )}
      </details>
    </li>
  );
}
