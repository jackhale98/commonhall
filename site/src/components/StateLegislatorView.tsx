import { useEffect, useState } from 'preact/hooks';
import { formatDate, partyClass, stateName } from '../lib/format';
import { stateBillFallbackHref, stateCommitteeHref, stateHref } from '../lib/paths';
import { select } from '../lib/rest';
import {
  STATE_LEGISLATOR_COLUMNS,
  chamberLabel,
  linkHost,
  roleLabel,
  roleRank,
  seatLabel,
  telHref,
  type StateLegislatorDetail,
} from '../lib/state-people';
import FollowButton from './FollowButton';
import Loader from './Loader';
import MemberPhoto from './MemberPhoto';

interface Seat {
  role: string | null;
  committee: { id: string; name: string; chamber: string | null; classification: string } | null;
}

interface SponsoredBill {
  id: string;
  session: string;
  identifier: string;
  title: string;
  latest_action_date: string | null;
  latest_action_text: string | null;
  primary: boolean;
}

/** One link per site: the repository often lists a site's page under several addresses. */
const uniqueHosts = (urls: string[]) => urls.filter((u, i) => urls.findIndex((v) => linkHost(v) === linkHost(u)) === i);

const BILL_COLUMNS = 'id,session,identifier,title,latest_action_date,latest_action_text';
const PAGE = 10;

/**
 * A state legislator: seat, contact details and committees (from Open States' people
 * repository) and the bills they sponsor (from the state bill sync). ?id=ocd-person/…
 */
export default function StateLegislatorView() {
  const [person, setPerson] = useState<StateLegislatorDetail | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [bills, setBills] = useState<SponsoredBill[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!id.startsWith('ocd-person/')) return setState('missing');
    (async () => {
      const [row] = await select<StateLegislatorDetail>('state_legislators', {
        id: `eq.${id}`,
        select: STATE_LEGISLATOR_COLUMNS,
      });
      if (!row) return setState('missing');
      const [committeeSeats, sponsorRows, primaryRows] = await Promise.all([
        select<Seat>('state_committee_members', {
          person_id: `eq.${id}`,
          select: 'role,committee:state_committees(id,name,chamber,classification)',
        }),
        select<{ is_primary: boolean; bill: Omit<SponsoredBill, 'primary'> | null }>('state_bill_sponsors', {
          person_id: `eq.${id}`,
          select: `is_primary,bill:state_bills(${BILL_COLUMNS})`,
          limit: 500,
        }),
        // Bills stored before every sponsor was kept still name their main sponsor.
        select<Omit<SponsoredBill, 'primary'>>('state_bills', {
          primary_sponsor_id: `eq.${id}`,
          select: BILL_COLUMNS,
          limit: 500,
        }),
      ]);
      const byId = new Map<string, SponsoredBill>();
      for (const b of primaryRows) byId.set(b.id, { ...b, primary: true });
      for (const s of sponsorRows)
        if (s.bill) byId.set(s.bill.id, { ...s.bill, primary: s.is_primary || byId.has(s.bill.id) });
      setPerson(row);
      setSeats(
        committeeSeats
          .filter((s) => s.committee)
          .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.committee!.name.localeCompare(b.committee!.name)),
      );
      setBills(
        [...byId.values()].sort(
          (a, b) =>
            Number(b.primary) - Number(a.primary) ||
            (b.latest_action_date ?? '').localeCompare(a.latest_action_date ?? ''),
        ),
      );
      setState('ready');
      document.title = `${row.name} · ${document.title.split(' · ').pop()}`;
    })().catch(() => setState('error'));
  }, []);

  if (state === 'loading') return <Loader label="Loading legislator" />;
  if (state === 'missing') return <p class="notice">We don’t have that state legislator.</p>;
  if (state === 'error' || !person) return <p class="notice error">Couldn’t load this legislator.</p>;

  const primaryCount = bills.filter((b) => b.primary).length;
  const phones = person.offices.filter((o) => o.voice);
  return (
    <article class="state-person">
      <nav aria-label="Breadcrumb" class="small muted">
        <a href={stateHref(person.state)}>{stateName(person.state)}</a> › Legislators
      </nav>
      <header class="person-head">
        <MemberPhoto name={person.name} url={person.photo_url} size={96} eager />
        <div>
          <h1>{person.name}</h1>
          <p class="person-meta">
            {person.party && <span class={`party ${partyClass(person.party)}`}>{person.party}</span>}{' '}
            {seatLabel(person)} · {stateName(person.state)}
            {!person.current && ' · former member'}
          </p>
          <FollowButton targetType="state_legislator" targetId={person.id} label={person.name} />
        </div>
      </header>

      {(person.email || phones.length > 0 || person.offices.length > 0 || person.links.length > 0) && (
        <section class="panel contact" aria-labelledby="contact-h">
          <h2 id="contact-h" class="h-small">
            Contact
          </h2>
          <ul class="contact-list">
            {person.email && (
              <li>
                <span class="small muted">Email</span>
                <a href={`mailto:${person.email}`}>{person.email}</a>
              </li>
            )}
            {person.offices.map((o) => {
              const tel = telHref(o.voice);
              return (
                <li>
                  <span class="small muted">
                    {o.classification === 'district' ? 'District office' : 'Capitol office'}
                  </span>
                  {o.voice && (tel ? <a href={tel}>{o.voice}</a> : <span>{o.voice}</span>)}
                  {o.address && <span class="small">{o.address}</span>}
                </li>
              );
            })}
            {person.links.length > 0 && (
              <li>
                <span class="small muted">Web</span>
                <span class="cluster">
                  {uniqueHosts(person.links).map((url) => (
                    <a href={url} rel="noopener">
                      {linkHost(url)}
                    </a>
                  ))}
                </span>
              </li>
            )}
          </ul>
        </section>
      )}

      <section aria-labelledby="committees-h">
        <h2 id="committees-h">Committees</h2>
        {seats.length === 0 ? (
          <p class="muted">No committee assignments listed.</p>
        ) : (
          <ul class="plain-rows committee-seats">
            {seats.map((s) => (
              <li>
                <a href={stateCommitteeHref(s.committee!.id)}>{s.committee!.name}</a>
                <span class="small muted">
                  {[roleLabel(s.role), chamberLabel(person.state, s.committee!.chamber)].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="bills-h">
        <h2 id="bills-h">Sponsored bills</h2>
        {bills.length === 0 ? (
          <p class="muted">
            No sponsored bills loaded yet. {stateName(person.state)}’s bills sync from Open States a little each day.
          </p>
        ) : (
          <>
            <p class="small muted">
              {primaryCount.toLocaleString()} as lead sponsor
              {bills.length > primaryCount && `, ${(bills.length - primaryCount).toLocaleString()} as co-sponsor`}
            </p>
            <ul class="list">
              {bills.slice(0, shown).map((b) => (
                <li>
                  <p class="small muted">
                    {b.identifier} · {b.session} · {b.primary ? 'Lead sponsor' : 'Co-sponsor'}
                  </p>
                  <p class="state-bill-title">
                    <a href={stateBillFallbackHref(b.id)}>{b.title}</a>
                  </p>
                  {b.latest_action_text && (
                    <p class="small muted">
                      {formatDate(b.latest_action_date)}: {b.latest_action_text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {bills.length > shown && (
              <button type="button" onClick={() => setShown(shown + PAGE)}>
                Show more ({(bills.length - shown).toLocaleString()} left)
              </button>
            )}
          </>
        )}
      </section>

      <p class="small muted">
        Contact details and committees from{' '}
        <a href="https://github.com/openstates/people" rel="noopener">
          Open States
        </a>
        , refreshed weekly
        {person.openstates_url && (
          <>
            {' '}
            (
            <a href={person.openstates_url} rel="noopener">
              profile
            </a>
            )
          </>
        )}
        . Check an office’s own site before relying on hours or addresses.
      </p>
    </article>
  );
}
