import { useEffect, useState } from 'preact/hooks';
import { getClient, hasStoredSession, savedDistricts } from '../lib/auth';
import { memberTag } from '../lib/format';
import { href, memberHref } from '../lib/paths';
import type { Member } from '../lib/types';
import MemberPhoto from './MemberPhoto';
import { isMine } from '../lib/pinned';

type Row = Pick<Member, 'bioguide_id' | 'name' | 'party' | 'state' | 'district' | 'chamber' | 'photo_url'>;

/** Members of Congress the signed-in visitor follows, other than their own (shown above); nothing otherwise. */
export default function YourMembers() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!hasStoredSession()) return;
    (async () => {
      const client = await getClient();
      const { data: session } = await client.auth.getSession();
      if (!session.session) return;
      const { data } = await client.from('follows').select('target_id').eq('target_type', 'member');
      const ids = (data ?? []).map((f: { target_id: string }) => f.target_id);
      if (!ids.length) return;
      const { data: members } = await client
        .from('members')
        .select('bioguide_id,name,party,state,district,chamber,photo_url')
        .in('bioguide_id', ids)
        .order('name');
      // Your own senators and representative are listed above, under Your representatives.
      const d = await savedDistricts();
      setRows(
        ((members ?? []) as Row[]).filter(
          (m) =>
            !d || !isMine({ chamber: m.chamber, district: m.district }, { kind: 'congress', state: m.state ?? '' }, d),
        ),
      );
    })().catch(() => undefined);
  }, []);

  if (!rows.length) return null;
  return (
    <section class="your-members" aria-labelledby="your-members-h">
      <div class="section-head">
        <h2 id="your-members-h" class="h-small">
          Members you follow
        </h2>
        <a class="see-all" href={href('following/')}>
          All you follow
        </a>
      </div>
      <ul class="member-rows">
        {rows.map((m) => (
          <li key={m.bioguide_id}>
            <MemberPhoto name={m.name} url={m.photo_url} bioguideId={m.bioguide_id} size={28} />
            <span class="row-text">
              <a href={memberHref(m.bioguide_id)}>{m.name}</a>
              <span class="small muted">{memberTag(m)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
