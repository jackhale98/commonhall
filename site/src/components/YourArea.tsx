import { useEffect, useState } from 'preact/hooks';
import { savedDistricts } from '../lib/auth';
import { CITIES } from '../lib/cities';
import { formatDate, partyLetter } from '../lib/format';
import type { MyArea } from '../lib/my-area';
import { cityHref, href, localOfficialHref, memberHref, stateLegislatorHref, voteHref } from '../lib/paths';
import { repsFromProfile, type Result } from '../lib/reps';
import { select } from '../lib/rest';
import { groupVotes, lastName, type RepVoteGroup, type RepVoteRow } from '../lib/rep-votes';
import { voteAbout } from '../lib/votes';
import MemberPhoto from './MemberPhoto';
import YourCity from './YourCity';

const POSITION: Record<string, string> = { yea: 'Yes', nay: 'No', present: 'Present', not_voting: 'Didn’t vote' };

const role = (chamber: string | null) =>
  chamber === 'senate' ? 'Senator' : chamber === 'upper' ? 'State senator' : chamber === 'lower' ? 'State rep.' : '';

/**
 * The home page for a visitor whose districts are saved (to their account or on this
 * device): their representatives, how their members of Congress voted lately and
 * their city. Nothing otherwise; the page shows Find my reps instead (hidden by CSS
 * once an area is known, see html[data-area]).
 */
export default function YourArea() {
  const [area, setArea] = useState<MyArea | null>(null);
  const [reps, setReps] = useState<Result | null>(null);
  const [votes, setVotes] = useState<RepVoteGroup[] | null>(null);

  useEffect(() => {
    (async () => {
      const a = await savedDistricts();
      if (!a?.state) return;
      document.documentElement.dataset.area = '';
      setArea(a);
      const r = await repsFromProfile({ ...a, address_label: a.label });
      setReps(r);
      const names = new Map((r?.federal ?? []).map((m) => [m.bioguide_id, lastName(m.name)]));
      if (!names.size) return setVotes([]);
      const rows = await select<RepVoteRow>('member_votes', {
        select: 'member_id,vote_id,position,chamber,date,question,title,result,bill_id,bill_title,yea_total,nay_total',
        member_id: `in.(${[...names.keys()].join(',')})`,
        order: 'date.desc.nullslast,vote_id.desc',
        limit: 40,
      });
      setVotes(groupVotes(rows, names));
    })().catch(() => setVotes((v) => v ?? []));
  }, []);

  if (!area?.state) return null;
  const city = area.city ? CITIES[area.city] : undefined;
  const councilor = reps?.localOfficials?.find((o) => o.district !== null && o.district === area.council_district);
  const atLarge = (reps?.localOfficials ?? []).filter((o) => o !== councilor).length;

  return (
    <section class="your-area" aria-labelledby="your-area-h">
      <h2 id="your-area-h">Your government</h2>
      <p class="small muted ya-where">
        {area.label ? `For ${area.label}` : 'For your saved districts'} · <a href={href('reps/')}>Change</a>
      </p>

      <div class="ya-grid">
        <div class="ya-card">
          <h3 class="ya-title">Your representatives</h3>
          {!reps ? (
            <p class="small muted">Loading…</p>
          ) : (
            <ul class="member-rows ya-people">
              {reps.federal.map((m) => (
                <li key={m.bioguide_id}>
                  <MemberPhoto name={m.name} url={m.photo_url} bioguideId={m.bioguide_id} size={32} />
                  <span class="row-text">
                    <a href={memberHref(m.bioguide_id)}>{m.name}</a>
                    <span class="small muted">
                      {m.chamber === 'senate'
                        ? 'U.S. Senator'
                        : `U.S. Rep., ${m.district === 0 ? 'at large' : `district ${m.district}`}`}
                      {partyLetter(m.party) && ` · ${partyLetter(m.party)}`}
                    </span>
                  </span>
                </li>
              ))}
              {reps.stateLegislators.map((l) => (
                <li key={l.id}>
                  <MemberPhoto name={l.name} url={l.photo_url} size={32} />
                  <span class="row-text">
                    <a href={stateLegislatorHref(l.id)}>{l.name}</a>
                    <span class="small muted">
                      {role(l.chamber)}
                      {l.district ? `, ${l.district}` : ''}
                      {partyLetter(l.party) && ` · ${partyLetter(l.party)}`}
                    </span>
                  </span>
                </li>
              ))}
              {councilor && (
                <li key={councilor.id}>
                  <MemberPhoto name={councilor.name} url={councilor.photo_url} size={32} />
                  <span class="row-text">
                    <a href={localOfficialHref(councilor.id)}>{councilor.name}</a>
                    <span class="small muted">
                      {city?.council ?? 'City council'}, {city?.districtWord?.toLowerCase() ?? 'district'}{' '}
                      {councilor.district}
                    </span>
                  </span>
                </li>
              )}
            </ul>
          )}
          {city && atLarge > 0 && (
            <p class="small muted ya-foot">
              Plus {atLarge} at-large {atLarge === 1 ? 'councilor' : 'councilors'}:{' '}
              <a href={cityHref(city, 'council/')}>the whole council</a>
            </p>
          )}
        </div>

        <div class="ya-card">
          <h3 class="ya-title">How they voted lately</h3>
          {votes === null ? (
            <p class="small muted">Loading…</p>
          ) : votes.length === 0 ? (
            <p class="small muted">No recent roll-call votes.</p>
          ) : (
            <ul class="ya-votes">
              {votes.map(({ row, positions }) => {
                const about = voteAbout(row, row.bill_title);
                return (
                  <li key={row.vote_id}>
                    <a href={voteHref(row.vote_id)}>
                      {[about.bill, about.subject].filter(Boolean).join(': ') || row.question || 'Roll-call vote'}
                    </a>
                    <span class="small muted">
                      {row.chamber === 'house' ? 'House' : 'Senate'} · {formatDate(row.date)}
                      {row.result && ` · ${row.result}, ${row.yea_total}–${row.nay_total}`}
                    </span>
                    <span class="ya-positions">
                      {positions.map((p) => (
                        <span>
                          {p.name} <strong class={`position-${p.position}`}>{POSITION[p.position]}</strong>
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {city && <YourCity city={city.key} district={area.council_district} />}
    </section>
  );
}
