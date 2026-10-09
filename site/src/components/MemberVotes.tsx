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

const FIRST = 3;
const MORE = 5;
const BATCH = 15;

const toItem = (d: Row): VoteListItemData => ({
  id: d.vote_id,
  chamber: d.chamber,
  roll_number: d.roll_number,
  date: d.date,
  question: d.question,
  result: d.result,
  position: d.position,
  yea_total: d.yea_total,
  nay_total: d.nay_total,
});

/**
 * A member's most recent roll-call votes, loaded live (or passed in, in demo mode):
 * the latest three, then five more at a time, fetching further back as needed.
 */
export default function MemberVotes({ memberId, initial }: { memberId: string; initial?: VoteListItemData[] }) {
  const [rows, setRows] = useState<VoteListItemData[] | null>(initial ?? null);
  const [shown, setShown] = useState(FIRST);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = (offset: number) =>
    select<Row>('member_votes', {
      member_id: `eq.${memberId}`,
      select: 'vote_id,position,chamber,roll_number,date,question,result,yea_total,nay_total',
      order: 'date.desc.nullslast,vote_id.desc',
      limit: BATCH,
      offset,
    }).then((data) => {
      setMore(data.length === BATCH);
      return data.map(toItem);
    });

  useEffect(() => {
    if (initial) return;
    load(0)
      .then(setRows)
      .catch(() => setError(true));
  }, [memberId]);

  const showMore = () => {
    const next = shown + MORE;
    setShown(next);
    if (rows && !initial && more && next > rows.length - MORE) {
      setLoading(true);
      load(rows.length)
        .then((data) => setRows([...rows, ...data]))
        .catch(() => setMore(false))
        .finally(() => setLoading(false));
    }
  };

  if (error) return <p class="muted">Couldn’t load recent votes.</p>;
  if (rows === null)
    return (
      <p class="muted" aria-live="polite">
        Loading recent votes…
      </p>
    );
  if (rows.length === 0) return <p class="muted">No recorded votes yet.</p>;
  const hasMore = rows.length > shown || (more && !initial);
  return (
    <>
      <VoteList votes={rows.slice(0, shown)} />
      {hasMore && (
        <button
          type="button"
          style={{ marginTop: 'var(--space-3)' }}
          onClick={showMore}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? 'Loading…' : 'Show more votes'}
        </button>
      )}
    </>
  );
}
