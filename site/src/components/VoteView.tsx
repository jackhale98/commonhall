import { useEffect, useMemo, useState } from 'preact/hooks';
import { parseBillId, parseVoteId } from '@civic/congress-client/ids';
import { billNumberLabel, formatDateTime, partyLabel, stateName } from '../lib/format';
import { billHref } from '../lib/paths';
import { select } from '../lib/rest';
import type { Member } from '../lib/types';
import { voteSegments } from '../lib/charts';
import MemberChip from './MemberChip';
import StackedBar from './viz/StackedBar';
import Loader from './Loader';

export interface Vote {
  id: string;
  chamber: 'house' | 'senate';
  congress: number;
  session: number;
  roll_number: number;
  date: string | null;
  question: string | null;
  title: string | null;
  vote_type: string | null;
  majority_requirement: string | null;
  result: string | null;
  bill_id: string | null;
  amendment: string | null;
  yea_total: number;
  nay_total: number;
  present_total: number;
  not_voting_total: number;
  source_url: string | null;
}

export type Position = 'yea' | 'nay' | 'present' | 'not_voting';
export interface Row {
  member_id: string;
  position: Position;
  party: string | null;
  member: Pick<Member, 'bioguide_id' | 'name' | 'party' | 'state' | 'district' | 'chamber'> | null;
}

export const POSITION_LABELS: Record<Position, string> = {
  yea: 'Yea',
  nay: 'Nay',
  present: 'Present',
  not_voting: 'Not voting',
};

interface Props {
  /** Prerendered data (demo mode); otherwise the vote is loaded from ?id=. */
  initial?: { vote: Vote; rows: Row[] };
}

export default function VoteView({ initial }: Props) {
  const [vote, setVote] = useState<Vote | null>(initial?.vote ?? null);
  const [rows, setRows] = useState<Row[]>(initial?.rows ?? []);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'invalid' | 'error'>(
    initial ? 'ready' : 'loading',
  );
  const [stateFilter, setStateFilter] = useState('');

  useEffect(() => {
    if (initial) return;
    const id = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!parseVoteId(id)) return setState('invalid');
    (async () => {
      const [v] = await select<Vote>('votes', { id: `eq.${id}` });
      if (!v) return setState('missing');
      const positions = await select<Row>('vote_positions', {
        vote_id: `eq.${id}`,
        select: 'member_id,position,party,member:members(bioguide_id,name,party,state,district,chamber)',
      });
      setVote(v);
      setRows(positions);
      setState('ready');
      document.title = `${v.chamber === 'house' ? 'House' : 'Senate'} roll call ${v.roll_number} · ${document.title.split(' · ').pop()}`;
    })().catch(() => setState('error'));
  }, []);

  const byParty = useMemo(() => {
    const table = new Map<string, Record<Position, number>>();
    for (const r of rows) {
      const p = (r.party ?? r.member?.party ?? '?').charAt(0);
      const t = table.get(p) ?? { yea: 0, nay: 0, present: 0, not_voting: 0 };
      t[r.position] += 1;
      table.set(p, t);
    }
    const order = ['D', 'R', 'I'];
    return [...table.entries()].sort((a, b) => ((order.indexOf(a[0]) + 10) % 13) - ((order.indexOf(b[0]) + 10) % 13));
  }, [rows]);

  const states = useMemo(
    () => [...new Set(rows.map((r) => r.member?.state).filter(Boolean))].sort() as string[],
    [rows],
  );

  if (state === 'loading') return <Loader label="Loading vote" />;
  if (state === 'invalid') return <p class="notice error">That isn’t a valid vote id. Ids look like house-119-2-80.</p>;
  if (state === 'missing') return <p class="notice">We don’t have that roll call.</p>;
  if (state === 'error' || !vote) return <p class="notice error">Couldn’t load this vote.</p>;

  const bill = vote.bill_id ? parseBillId(vote.bill_id) : null;
  const chamber = vote.chamber === 'house' ? 'House' : 'Senate';
  const filtered = rows
    .filter((r) => !stateFilter || r.member?.state === stateFilter)
    .sort((a, b) => (a.member?.name ?? a.member_id).localeCompare(b.member?.name ?? b.member_id));

  return (
    <article>
      <p class="eyebrow">
        {chamber} roll call {vote.roll_number} · {vote.congress}th Congress, session {vote.session}
      </p>
      <h1>{vote.question ?? 'Roll-call vote'}</h1>
      {vote.title && <p class="official-title">{vote.title}</p>}
      <p class="meta cluster small">
        {vote.date && <span>{formatDateTime(vote.date)}</span>}
        {vote.majority_requirement && <span>{vote.majority_requirement} majority required</span>}
        {vote.amendment && <span>{vote.amendment}</span>}
      </p>
      {bill && (
        <p>
          On{' '}
          <a href={billHref(bill.congress, bill.type, bill.number)}>
            {billNumberLabel({ bill_type: bill.type, number: bill.number })}
          </a>
        </p>
      )}

      <div class="latest-action">
        <h2 class="h-small">Result</h2>
        <p>
          <strong>{vote.result ?? 'Unknown'}</strong> · {vote.yea_total} yea, {vote.nay_total} nay
          {vote.present_total > 0 && `, ${vote.present_total} present`}, {vote.not_voting_total} not voting
        </p>
        <StackedBar segments={voteSegments(vote)} legend />
      </div>

      <h2>By party</h2>
      {/* Party names without party colours: the bars' green and red mean yea and nay here. */}
      <p class="small muted">Green is yea, red is nay, gold is present, grey did not vote.</p>
      <div class="party-bars">
        {byParty.map(([party, t]) => (
          <div class="party-bar">
            <span class="party-name">{partyLabel(party)}</span>
            <StackedBar
              segments={voteSegments({
                yea_total: t.yea,
                nay_total: t.nay,
                present_total: t.present,
                not_voting_total: t.not_voting,
              })}
              label={`${partyLabel(party)}: ${t.yea} yea, ${t.nay} nay, ${t.present} present, ${t.not_voting} not voting`}
            />
            <span class="small">
              <strong>{t.yea}</strong> yea · <strong>{t.nay}</strong> nay
            </span>
          </div>
        ))}
      </div>
      <details class="more">
        <summary>Show as a table</summary>
        <div class="table-wrap">
          <table>
            <caption class="visually-hidden">Votes by party</caption>
            <thead>
              <tr>
                <th scope="col">Party</th>
                <th scope="col">Yea</th>
                <th scope="col">Nay</th>
                <th scope="col">Present</th>
                <th scope="col">Not voting</th>
              </tr>
            </thead>
            <tbody>
              {byParty.map(([party, t]) => (
                <tr>
                  <th scope="row">{partyLabel(party)}</th>
                  <td>{t.yea}</td>
                  <td>{t.nay}</td>
                  <td>{t.present}</td>
                  <td>{t.not_voting}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Total</th>
                <td>{vote.yea_total}</td>
                <td>{vote.nay_total}</td>
                <td>{vote.present_total}</td>
                <td>{vote.not_voting_total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <h2>How each member voted</h2>
      <div class="toolbar">
        <div class="field">
          <label for="vote-state">State</label>
          <select id="vote-state" value={stateFilter} onChange={(e) => setStateFilter(e.currentTarget.value)}>
            <option value="">All states</option>
            {states.map((s) => (
              <option value={s}>{stateName(s)}</option>
            ))}
          </select>
        </div>
      </div>
      <div class="positions">
        {(['yea', 'nay', 'present', 'not_voting'] as Position[]).map((p) => {
          const list = filtered.filter((r) => r.position === p);
          if (list.length === 0) return null;
          return (
            <section aria-labelledby={`pos-${p}`}>
              <h3 id={`pos-${p}`} class={`h-small position-${p}`}>
                {POSITION_LABELS[p]} ({list.length})
              </h3>
              <ul class="plain-members">
                {list.map((r) => (
                  <li>{r.member ? <MemberChip member={r.member} /> : r.member_id}</li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {rows.length < vote.yea_total + vote.nay_total + vote.present_total + vote.not_voting_total && (
        <p class="small muted">Some positions could not be matched to a member and are not listed.</p>
      )}
      {vote.source_url && (
        <p>
          <a href={vote.source_url} rel="noopener">
            Official record
          </a>
        </p>
      )}
    </article>
  );
}
