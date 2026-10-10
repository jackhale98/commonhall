import { useEffect, useState } from 'preact/hooks';
import { followedIds, hasStoredSession, savedDistricts } from '../lib/auth';
import { isMine, type PinScope, type PinnedPerson } from '../lib/pinned';
import { href } from '../lib/paths';
import MemberPhoto from './MemberPhoto';

interface Props {
  targetType: 'member' | 'state_legislator' | 'local_official';
  people: PinnedPerson[];
  scope: PinScope;
  /** "Your legislators", "Legislators you follow". */
  mineTitle: string;
  followedTitle: string;
}

function Rows({ people }: { people: PinnedPerson[] }) {
  return (
    <ul class="member-rows">
      {people.map((p) => (
        <li key={p.id}>
          <MemberPhoto name={p.name} url={p.photo_url} bioguideId={p.bioguideId} size={28} />
          <a href={p.href}>{p.name}</a>
          <span class="small muted">{p.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Above a page's full list: the signed-in visitor's own representatives (from the
 * districts Find my reps saved), then anyone else on the page they follow. Reads
 * only the visitor's own profile and follows; renders nothing when signed out or
 * when neither applies.
 */
export type { PinnedPerson };

export default function PinnedPeople({ targetType, people, scope, mineTitle, followedTitle }: Props) {
  const [mine, setMine] = useState<PinnedPerson[]>([]);
  const [followed, setFollowed] = useState<PinnedPerson[]>([]);

  useEffect(() => {
    if (!hasStoredSession()) return;
    Promise.all([savedDistricts(), followedIds(targetType)])
      .then(([d, ids]) => {
        const own = d ? people.filter((p) => isMine(p, scope, d)) : [];
        const ownIds = new Set(own.map((p) => p.id));
        const follows = new Set(ids);
        setMine(own);
        setFollowed(
          people.filter((p) => follows.has(p.id) && !ownIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => undefined);
  }, [targetType]);

  if (!mine.length && !followed.length) return null;
  return (
    <section class="your-followed" aria-label="Yours">
      {mine.length > 0 && (
        <div class="pinned-group">
          <div class="section-head">
            <h2 class="h-small">{mineTitle}</h2>
            <a class="see-all" href={href('#reps-h')}>
              Your address
            </a>
          </div>
          <Rows people={mine} />
        </div>
      )}
      {followed.length > 0 && (
        <div class="pinned-group">
          <div class="section-head">
            <h2 class="h-small">{followedTitle}</h2>
            <a class="see-all" href={href('following/')}>
              All you follow
            </a>
          </div>
          <Rows people={followed} />
        </div>
      )}
    </section>
  );
}
