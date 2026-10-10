import { useEffect, useState } from 'preact/hooks';
import { getClient, hasStoredSession } from '../lib/auth';
import { href } from '../lib/paths';
import MemberPhoto from './MemberPhoto';

export interface FollowedPerson {
  id: string;
  name: string;
  photo_url: string | null;
  /** "Senate · District 3", "District 6". */
  detail: string;
  href: string;
}

interface Props {
  targetType: 'state_legislator' | 'local_official';
  /** Everyone on the page; those the visitor follows are shown. */
  people: FollowedPerson[];
  title: string;
}

/**
 * The people on a page the signed-in visitor follows (state legislators, city
 * councilors), above the full list. Only the visitor's own follow ids are read;
 * renders nothing when signed out or following none of them.
 */
export default function YourFollowed({ targetType, people, title }: Props) {
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!hasStoredSession()) return;
    (async () => {
      const client = await getClient();
      const { data: session } = await client.auth.getSession();
      if (!session.session) return;
      const { data } = await client.from('follows').select('target_id').eq('target_type', targetType);
      setIds(new Set((data ?? []).map((f: { target_id: string }) => f.target_id)));
    })().catch(() => undefined);
  }, [targetType]);

  const rows = people.filter((p) => ids.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  if (!rows.length) return null;
  return (
    <section class="your-followed" aria-labelledby={`your-${targetType}-h`}>
      <div class="section-head">
        <h2 id={`your-${targetType}-h`} class="h-small">
          {title}
        </h2>
        <a class="see-all" href={href('following/')}>
          All you follow
        </a>
      </div>
      <ul class="member-rows">
        {rows.map((p) => (
          <li key={p.id}>
            <MemberPhoto name={p.name} url={p.photo_url} size={28} />
            <a href={p.href}>{p.name}</a>
            <span class="small muted">{p.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
