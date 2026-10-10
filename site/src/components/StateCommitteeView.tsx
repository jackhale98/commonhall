import { useEffect, useState } from 'preact/hooks';
import { partyClass, stateName } from '../lib/format';
import { stateCommitteeHref, stateHref, stateLegislatorHref } from '../lib/paths';
import { select } from '../lib/rest';
import {
  STATE_COMMITTEE_COLUMNS,
  chamberLabel,
  districtLabel,
  linkHost,
  roleLabel,
  roleRank,
  type CommitteeSeat,
  type StateCommittee,
} from '../lib/state-people';
import Loader from './Loader';

interface Person {
  id: string;
  party: string | null;
  chamber: string | null;
  district: string | null;
}

/** A state committee and its members, leadership first. ?id=ocd-organization/… */
export default function StateCommitteeView() {
  const [committee, setCommittee] = useState<StateCommittee | null>(null);
  const [seats, setSeats] = useState<CommitteeSeat[]>([]);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [parent, setParent] = useState<StateCommittee | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!id.startsWith('ocd-organization/')) return setState('missing');
    (async () => {
      const [row] = await select<StateCommittee>('state_committees', {
        id: `eq.${id}`,
        select: STATE_COMMITTEE_COLUMNS,
      });
      if (!row) return setState('missing');
      const members = await select<CommitteeSeat>('state_committee_members', {
        committee_id: `eq.${id}`,
        select: 'seq,person_id,name,role',
        order: 'seq',
      });
      const ids = members.map((m) => m.person_id).filter((p): p is string => Boolean(p));
      const [details, parents] = await Promise.all([
        ids.length
          ? select<Person>('state_legislators', {
              id: `in.(${ids.map((i) => `"${i}"`).join(',')})`,
              select: 'id,party,chamber,district',
            })
          : Promise.resolve([]),
        row.parent_id
          ? select<StateCommittee>('state_committees', { id: `eq.${row.parent_id}`, select: STATE_COMMITTEE_COLUMNS })
          : Promise.resolve([]),
      ]);
      setCommittee(row);
      setSeats([...members].sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.seq - b.seq));
      setPeople(new Map(details.map((d) => [d.id, d])));
      setParent(parents[0] ?? null);
      setState('ready');
      document.title = `${row.name} · ${document.title.split(' · ').pop()}`;
    })().catch(() => setState('error'));
  }, []);

  if (state === 'loading') return <Loader label="Loading committee" />;
  if (state === 'missing') return <p class="notice">We don’t have that committee.</p>;
  if (state === 'error' || !committee) return <p class="notice error">Couldn’t load this committee.</p>;

  const leaders = seats.filter((s) => roleRank(s.role) < 10);
  const rest = seats.filter((s) => roleRank(s.role) >= 10);
  const row = (s: CommitteeSeat) => {
    const p = s.person_id ? people.get(s.person_id) : undefined;
    return (
      <li>
        {s.person_id && p ? <a href={stateLegislatorHref(s.person_id)}>{s.name}</a> : <span>{s.name}</span>}
        {p?.party && (
          <span class={`party ${partyClass(p.party)}`} title={p.party}>
            {p.party.charAt(0)}
          </span>
        )}
        <span class="small muted">
          {[
            roleLabel(s.role),
            p && committee.chamber === 'legislature' ? chamberLabel(committee.state, p.chamber) : '',
            p ? districtLabel(p.district) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </li>
    );
  };

  return (
    <article class="state-committee">
      <nav aria-label="Breadcrumb" class="small muted">
        <a href={stateHref(committee.state)}>{stateName(committee.state)}</a> ›{' '}
        <a href={`${stateHref(committee.state)}#committees-h`}>Committees</a>
      </nav>
      <p class="kicker">
        {stateName(committee.state)} · {chamberLabel(committee.state, committee.chamber)}{' '}
        {committee.classification === 'subcommittee' ? 'subcommittee' : 'committee'}
      </p>
      <h1>{committee.name}</h1>
      {parent && (
        <p class="meta">
          Part of <a href={stateCommitteeHref(parent.id)}>{parent.name}</a>
        </p>
      )}
      {committee.url && (
        <p>
          <a class="button" href={committee.url} rel="noopener">
            Hearings and documents on {linkHost(committee.url)}
          </a>
        </p>
      )}
      <section aria-labelledby="members-h">
        <h2 id="members-h">
          Members <span class="muted">({seats.length})</span>
        </h2>
        {seats.length === 0 ? (
          <p class="muted">No members listed.</p>
        ) : (
          <>
            {leaders.length > 0 && <ul class="plain-rows committee-members">{leaders.map(row)}</ul>}
            {rest.length > 0 && <ul class="plain-rows committee-members">{rest.map(row)}</ul>}
          </>
        )}
      </section>
      <p class="small muted">
        Members from{' '}
        <a href="https://github.com/openstates/people" rel="noopener">
          Open States
        </a>
        , refreshed weekly.
      </p>
    </article>
  );
}
