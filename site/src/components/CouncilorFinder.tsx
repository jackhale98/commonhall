import { useState } from 'preact/hooks';
import { localOfficialHref } from '../lib/paths';
import MemberPhoto from './MemberPhoto';

export interface CouncilorRow {
  id: string;
  name: string;
  seat: string | null;
  district: number | null;
  photo_url: string | null;
}

type Seat = '' | 'district' | 'at-large';

/** Compact, filterable list of councilors: by name or district number, district or at-large seats. */
export default function CouncilorFinder({ councilors }: { councilors: CouncilorRow[] }) {
  const [q, setQ] = useState('');
  const [seat, setSeat] = useState<Seat>('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = councilors.filter((c) => {
    if (seat === 'district' && c.district === null) return false;
    if (seat === 'at-large' && c.district !== null) return false;
    const hay = `${c.name} ${c.seat ?? ''} ${c.district ?? 'at-large'}`.toLowerCase();
    // "7" or "district 7" finds District 7.
    return words.every((w) => (/^\d+$/.test(w) ? c.district === Number(w) : hay.includes(w)));
  });

  return (
    <div class="councilor-finder">
      <div class="councilor-tools">
        <label class="visually-hidden" for="cf-q">
          Find a councilor
        </label>
        <input
          id="cf-q"
          type="search"
          value={q}
          placeholder="Name or district number"
          onInput={(e) => setQ(e.currentTarget.value)}
        />
        <div class="type-chips" role="group" aria-label="Seat">
          {(
            [
              ['', 'All'],
              ['district', 'District'],
              ['at-large', 'At-large'],
            ] as const
          ).map(([key, label]) => (
            <button type="button" class="chip-button" aria-pressed={seat === key} onClick={() => setSeat(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {hits.length === 0 ? (
        <p class="muted">No councilor matches.</p>
      ) : (
        <ul class="councilor-grid">
          {hits.map((c) => (
            <li>
              <a class="councilor" href={localOfficialHref(c.id)}>
                <MemberPhoto name={c.name} url={c.photo_url} size={36} />
                <span>
                  <strong>{c.name}</strong>
                  <span class="small muted">{c.seat ?? 'Councilor'}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
