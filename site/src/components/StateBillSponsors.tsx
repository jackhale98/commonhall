import { useEffect, useState } from 'preact/hooks';
import { stateLegislatorHref } from '../lib/paths';
import { select } from '../lib/rest';

interface Sponsor {
  seq: number;
  person_id: string | null;
  name: string;
  is_primary: boolean;
}

const FIRST = 8;

/** A state bill's sponsors, lead sponsor first, each linked to their page. Read live, so it fills in as bills resync. */
export default function StateBillSponsors({ billId }: { billId: string }) {
  const [rows, setRows] = useState<Sponsor[]>([]);
  const [all, setAll] = useState(false);

  useEffect(() => {
    select<Sponsor>('state_bill_sponsors', {
      bill_id: `eq.${billId}`,
      select: 'seq,person_id,name,is_primary',
      order: 'seq',
    })
      .then(setRows)
      .catch(() => undefined);
  }, [billId]);

  const cosponsors = rows.filter((r) => !r.is_primary);
  if (cosponsors.length === 0) return null;
  const name = (r: Sponsor) => (r.person_id ? <a href={stateLegislatorHref(r.person_id)}>{r.name}</a> : r.name);
  const shown = all ? cosponsors : cosponsors.slice(0, FIRST);
  return (
    <p class="meta bill-cosponsors">
      Co-sponsors ({cosponsors.length}):{' '}
      {shown.map((r, i) => (
        <>
          {i > 0 && ', '}
          {name(r)}
        </>
      ))}
      {cosponsors.length > FIRST && (
        <>
          {' '}
          <button type="button" class="link-button" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `and ${cosponsors.length - FIRST} more`}
          </button>
        </>
      )}
    </p>
  );
}
