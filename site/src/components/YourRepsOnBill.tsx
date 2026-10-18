import { useEffect, useState } from 'preact/hooks';
import { savedDistricts } from '../lib/auth';
import { href, memberHref } from '../lib/paths';
import { billRecord, type BillVote } from '../lib/rep-votes';
import { federalReps, type FederalRep } from '../lib/reps';
import { select } from '../lib/rest';
import MemberPhoto from './MemberPhoto';

interface Props {
  sponsorId: string | null;
  cosponsorIds: string[];
  votes: BillVote[];
}

interface Position {
  vote_id: string;
  member_id: string;
  position: 'yea' | 'nay' | 'present' | 'not_voting';
}

/**
 * On a bill's page, for a visitor whose districts are saved: whether their members
 * of Congress sponsored or cosponsored it and how they voted on its roll calls.
 * Nothing otherwise.
 */
export default function YourRepsOnBill({ sponsorId, cosponsorIds, votes }: Props) {
  const [reps, setReps] = useState<FederalRep[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    (async () => {
      const d = await savedDistricts();
      if (!d?.state) return;
      const found = await federalReps(d);
      if (votes.length && found.length) {
        setPositions(
          await select<Position>('vote_positions', {
            select: 'vote_id,member_id,position',
            vote_id: `in.(${votes.map((v) => v.id).join(',')})`,
            member_id: `in.(${found.map((r) => r.bioguide_id).join(',')})`,
          }),
        );
      }
      setReps(found);
    })().catch(() => undefined);
  }, []);

  if (!reps.length) return null;
  return (
    <section class="your-reps-bill" aria-labelledby="your-reps-h">
      <div class="section-head">
        <h2 id="your-reps-h" class="h-small">
          Your members of Congress
        </h2>
        <a class="see-all" href={href('reps/')}>
          Your address
        </a>
      </div>
      <ul class="member-rows">
        {reps.map((r) => (
          <li key={r.bioguide_id}>
            <MemberPhoto name={r.name} url={r.photo_url} bioguideId={r.bioguide_id} size={32} />
            <span class="row-text">
              <a href={memberHref(r.bioguide_id)}>{r.name}</a>
              <span class="small muted">
                {billRecord(r, { sponsorId, cosponsorIds, votes }, positions).join(' · ')}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
