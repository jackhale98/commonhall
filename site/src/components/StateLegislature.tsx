import { useEffect, useState } from 'preact/hooks';
import { stateLegislatorHref } from '../lib/paths';
import PinnedPeople from './PinnedPeople';
import StateLegislators, { type LegislatorRow } from './StateLegislators';

interface Props {
  code: string;
  /** legislators.json for this state. */
  src: string;
  /** The first rows, prerendered (the full list is fetched, not embedded in the page). */
  initial: LegislatorRow[];
  chambers: { key: string; label: string; count: number }[];
}

const districtLabel = (d: string | null) => (d && /^\d+$/.test(d) ? `District ${d}` : d);

/**
 * A state's Legislature tab: the visitor's own legislators and those they follow,
 * then every legislator with search. The list is one fetched file shared by both,
 * so a big chamber (New Hampshire's 400 seats) isn't serialized into the page twice.
 */
export default function StateLegislature({ code, src, initial, chambers }: Props) {
  const [rows, setRows] = useState<LegislatorRow[] | null>(null);
  useEffect(() => {
    fetch(src)
      .then((r) => (r.ok ? (r.json() as Promise<LegislatorRow[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setRows)
      .catch(() => undefined);
  }, [src]);
  const label = new Map(chambers.map((c) => [c.key, c.label]));
  return (
    <>
      {rows && (
        <PinnedPeople
          targetType="state_legislator"
          scope={{ kind: 'legislature', state: code }}
          mineTitle="Your state legislators"
          followedTitle="Legislators you follow"
          people={rows.map((l) => ({
            id: l.id,
            name: l.name,
            photo_url: l.photo_url ?? null,
            chamber: l.chamber,
            district: l.district,
            detail: [l.party?.charAt(0), label.get(l.chamber), districtLabel(l.district)].filter(Boolean).join(' · '),
            href: stateLegislatorHref(l.id),
          }))}
        />
      )}
      <h2 class="h-small">State legislators</h2>
      <StateLegislators legislators={rows ?? initial} chambers={chambers} loading={rows === null} />
    </>
  );
}
