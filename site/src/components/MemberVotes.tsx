import { useEffect, useState } from 'preact/hooks';
import { select } from '../lib/rest';
import VoteList, { type VoteListItemData } from './VoteList';

interface Row {
  vote_id: string;
  position: VoteListItemData['position'];
  chamber: 'house' | 'senate';
  roll_number: number;
  date: string | null;
  question: string | null;
  result: string | null;
  yea_total: number;
  nay_total: number;
}

/** A member's most recent roll-call votes, loaded live (or passed in, in demo mode). */
export default function MemberVotes({ memberId, initial }: { memberId: string; initial?: VoteListItemData[] }) {
  const [rows, setRows] = useState<VoteListItemData[] | null>(initial ?? null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (initial) return;
    (async () => {
      const data = await select<Row>('member_votes', {
        member_id: `eq.${memberId}`,
        select: 'vote_id,position,chamber,roll_number,date,question,result,yea_total,nay_total',
        order: 'date.desc.nullslast',
        limit: 15,
      });
      setRows(
        data.map((d) => ({
          id: d.vote_id,
          chamber: d.chamber,
          roll_number: d.roll_number,
          date: d.date,
          question: d.question,
          result: d.result,
          position: d.position,
          yea_total: d.yea_total,
          nay_total: d.nay_total,
        })),
      );
    })().catch(() => setError(true));
  }, [memberId]);

  if (error) return <p class="muted">Couldn’t load recent votes.</p>;
  if (rows === null)
    return (
      <p class="muted" aria-live="polite">
        Loading recent votes…
      </p>
    );
  if (rows.length === 0) return <p class="muted">No recorded votes yet.</p>;
  return <VoteList votes={rows} />;
}
