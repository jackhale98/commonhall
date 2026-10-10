import type { BillCommittee } from '../lib/committees';
import { partySegments } from '../lib/charts';
import type { Member } from '../lib/types';
import BillCommittees from './BillCommittees';
import MemberChip from './MemberChip';
import StackedBar from './viz/StackedBar';

type MemberRef = Pick<Member, 'bioguide_id' | 'name' | 'party' | 'state' | 'district' | 'chamber'>;

interface Props {
  sponsor: MemberRef | null;
  /** Current cosponsors (withdrawn ones left out), in the order they signed on. */
  cosponsors: { member_id: string; is_original?: boolean; member: MemberRef | null }[];
  withdrawn?: number;
  committees: BillCommittee[];
  /** Committee codes that have a page; others are shown unlinked. */
  knownCommittees?: Set<string>;
  subjects: string[];
}

/**
 * Who sponsors a bill, where it was sent and what it is about, as three boxes
 * that open on a tap. Closed, each still says the gist (the sponsor's name, the
 * first committee, the number of subjects), so the page stays short.
 */
export default function BillFacts({
  sponsor,
  cosponsors,
  withdrawn = 0,
  committees,
  knownCommittees,
  subjects,
}: Props) {
  const parties: Record<string, number> = {};
  for (const c of cosponsors) {
    const p = c.member?.party ?? '?';
    parties[p] = (parties[p] ?? 0) + 1;
  }
  const firstCommittee = [...committees].sort((a, b) =>
    (a.referred_date ?? '').localeCompare(b.referred_date ?? ''),
  )[0];
  return (
    <div class="bill-facts">
      <details class="panel bill-fact">
        <summary>
          <span class="fact-label">Sponsor</span>
          <span class="fact-gist">
            {sponsor ? sponsor.name : 'Not recorded'}
            {cosponsors.length > 0 && ` + ${cosponsors.length} cosponsor${cosponsors.length === 1 ? '' : 's'}`}
          </span>
        </summary>
        <div class="fact-body">
          {sponsor && <MemberChip member={sponsor} />}
          {cosponsors.length > 0 ? (
            <>
              <p class="h-small fact-sub">Cosponsors ({cosponsors.length})</p>
              <StackedBar
                segments={partySegments(parties)}
                label={`Cosponsors by party: ${Object.entries(parties)
                  .map(([p, n]) => `${n} ${p}`)
                  .join(', ')}`}
                legend
              />
              <ul class="plain-list">
                {cosponsors.map((c) => (
                  <li>
                    {c.member ? <MemberChip member={c.member} /> : c.member_id}
                    {c.is_original && <span class="small muted"> · original</span>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p class="small muted">No cosponsors.</p>
          )}
          {withdrawn > 0 && <p class="small muted">{withdrawn} withdrew their cosponsorship.</p>}
        </div>
      </details>

      <details class="panel bill-fact">
        <summary>
          <span class="fact-label">Committees</span>
          <span class="fact-gist">
            {firstCommittee
              ? `${firstCommittee.committee_name ?? firstCommittee.committee_code}${committees.length > 1 ? ` + ${committees.length - 1} more` : ''}`
              : 'None yet'}
          </span>
        </summary>
        <div class="fact-body">
          {committees.length > 0 ? (
            <BillCommittees rows={committees} known={knownCommittees} />
          ) : (
            <p class="small muted">Not referred to a committee yet.</p>
          )}
        </div>
      </details>

      <details class="panel bill-fact">
        <summary>
          <span class="fact-label">Subjects</span>
          <span class="fact-gist">
            {subjects.length === 0 ? 'None yet' : `${subjects.length} subject${subjects.length === 1 ? '' : 's'}`}
          </span>
        </summary>
        <div class="fact-body">
          {subjects.length > 0 ? (
            <ul class="chips">
              {subjects.map((s) => (
                <li class="chip">{s}</li>
              ))}
            </ul>
          ) : (
            <p class="small muted">The Library of Congress hasn’t tagged this bill yet.</p>
          )}
        </div>
      </details>
    </div>
  );
}
