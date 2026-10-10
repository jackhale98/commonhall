import { useEffect, useState } from 'preact/hooks';
import { parseBillId } from '@civic/congress-client/ids';
import { accountUrl, getClient, hasStoredSession, unfollow } from '../lib/auth';
import { billDisplayTitle, billNumberLabel } from '../lib/format';
import {
  billHref,
  discussionHref,
  href,
  localMatterHref,
  localOfficialHref,
  memberHref,
  stateBillFallbackHref,
  stateLegislatorHref,
} from '../lib/paths';
import Loader from './Loader';

interface Follow {
  target_type: 'bill' | 'member' | 'state_bill' | 'state_legislator' | 'local_matter' | 'local_official' | 'discussion';
  target_id: string;
  created_at: string;
}

interface BillRef {
  id: string;
  congress: number;
  bill_type: string;
  number: number;
  title: string;
  short_title: string | null;
}
interface MemberRef {
  bioguide_id: string;
  name: string;
  party: string | null;
  state: string | null;
}
interface StateBillRef {
  id: string;
  state: string;
  identifier: string;
  title: string;
  openstates_url: string | null;
}
interface LegislatorRef {
  id: string;
  name: string;
  state: string;
  party: string | null;
  chamber: string | null;
  district: string | null;
  openstates_url: string | null;
}

/** "Democratic · MA Senate, 2nd Suffolk": who a state legislator is, in one line. */
function legislatorDetail(l: LegislatorRef): string {
  const chamber = l.chamber === 'upper' ? 'Senate' : l.chamber === 'lower' ? 'House' : 'Legislature';
  const district = l.district ? (/^\d+$/.test(l.district) ? `District ${l.district}` : l.district) : '';
  return [l.party, `${l.state} ${chamber}${district ? `, ${district}` : ''}`].filter(Boolean).join(' · ');
}

interface Row extends Follow {
  label: string;
  detail?: string;
  link?: string;
}

const GROUPS: { type: Follow['target_type']; title: string }[] = [
  { type: 'bill', title: 'Bills' },
  { type: 'member', title: 'Members of Congress' },
  { type: 'state_bill', title: 'State bills' },
  { type: 'state_legislator', title: 'State legislators' },
  { type: 'local_matter', title: 'Boston council matters' },
  { type: 'local_official', title: 'Boston councilors' },
  { type: 'discussion', title: 'Discussions' },
];

export default function FollowingList() {
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!hasStoredSession()) return setState('signed-out');
    (async () => {
      const client = await getClient();
      const { data: session } = await client.auth.getSession();
      if (!session.session) return setState('signed-out');
      const { data, error } = await client
        .from('follows')
        .select('target_type,target_id,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const follows = (data ?? []) as Follow[];
      const ids = (type: Follow['target_type']) =>
        follows.filter((f) => f.target_type === type).map((f) => f.target_id);
      const named = async (table: string, columns: string, type: Follow['target_type']) =>
        ids(type).length
          ? new Map(
              (
                ((await client.from(table).select(columns).in('id', ids(type))).data ?? []) as unknown as {
                  id: string;
                  [k: string]: unknown;
                }[]
              ).map((r) => [r.id, r]),
            )
          : new Map<string, { id: string; [k: string]: unknown }>();
      const [matters, officials, discussions] = await Promise.all([
        named('local_matters', 'id,file_number,title', 'local_matter'),
        named('local_officials', 'id,name,seat', 'local_official'),
        named('discussions', 'id,title,status', 'discussion'),
      ]);
      const [bills, members, stateBills, legislators] = await Promise.all([
        ids('bill').length
          ? client.from('bills').select('id,congress,bill_type,number,title,short_title').in('id', ids('bill'))
          : { data: [] },
        ids('member').length
          ? client.from('members').select('bioguide_id,name,party,state').in('bioguide_id', ids('member'))
          : { data: [] },
        ids('state_bill').length
          ? client.from('state_bills').select('id,state,identifier,title,openstates_url').in('id', ids('state_bill'))
          : { data: [] },
        ids('state_legislator').length
          ? client
              .from('state_legislators')
              .select('id,name,state,party,chamber,district,openstates_url')
              .in('id', ids('state_legislator'))
          : { data: [] },
      ]);
      const billMap = new Map(((bills.data ?? []) as BillRef[]).map((b) => [b.id, b]));
      const memberMap = new Map(((members.data ?? []) as MemberRef[]).map((m) => [m.bioguide_id, m]));
      const stateBillMap = new Map(((stateBills.data ?? []) as StateBillRef[]).map((b) => [b.id, b]));
      const legislatorMap = new Map(((legislators.data ?? []) as LegislatorRef[]).map((l) => [l.id, l]));
      setRows(
        follows.map((f) => {
          if (f.target_type === 'bill') {
            const b = billMap.get(f.target_id);
            const ref = parseBillId(f.target_id);
            return {
              ...f,
              label: b ? `${billNumberLabel(b)}: ${billDisplayTitle(b)}` : f.target_id,
              link: ref ? billHref(ref.congress, ref.type, ref.number) : undefined,
            };
          }
          if (f.target_type === 'member') {
            const m = memberMap.get(f.target_id);
            return {
              ...f,
              label: m?.name ?? f.target_id,
              detail: m ? `${m.party ?? ''}-${m.state ?? ''}` : undefined,
              link: memberHref(f.target_id),
            };
          }
          if (f.target_type === 'state_bill') {
            const b = stateBillMap.get(f.target_id);
            return {
              ...f,
              label: b ? `${b.state} ${b.identifier}: ${b.title}` : f.target_id,
              link: stateBillFallbackHref(f.target_id),
            };
          }
          if (f.target_type === 'local_matter') {
            const m = matters.get(f.target_id);
            return {
              ...f,
              label: m ? `${m.file_number ? `Docket #${m.file_number}: ` : ''}${String(m.title)}` : f.target_id,
              link: localMatterHref(f.target_id),
            };
          }
          if (f.target_type === 'local_official') {
            const o = officials.get(f.target_id);
            return {
              ...f,
              label: o ? String(o.name) : f.target_id,
              detail: o?.seat ? String(o.seat) : undefined,
              link: localOfficialHref(f.target_id),
            };
          }
          if (f.target_type === 'discussion') {
            const d = discussions.get(f.target_id);
            return {
              ...f,
              label: d ? String(d.title) : f.target_id,
              detail: d ? String(d.status) : undefined,
              link: discussionHref(f.target_id),
            };
          }
          const l = legislatorMap.get(f.target_id);
          return {
            ...f,
            label: l?.name ?? f.target_id,
            detail: l ? legislatorDetail(l) : undefined,
            link: stateLegislatorHref(f.target_id),
          };
        }),
      );
      setState('ready');
    })().catch(() => setState('error'));
  }, []);

  async function remove(row: Row) {
    await unfollow(row.target_type, row.target_id);
    setRows((prev) => prev.filter((r) => !(r.target_type === row.target_type && r.target_id === row.target_id)));
  }

  if (state === 'loading') return <Loader label="Loading what you follow" />;
  if (state === 'signed-out') {
    return (
      <p class="notice">
        <a href={accountUrl(href('following/'))}>Sign in</a> to manage what you follow.
      </p>
    );
  }
  if (state === 'error') return <p class="notice error">Couldn’t load your follows.</p>;
  if (rows.length === 0) {
    return (
      <p class="muted">
        You aren’t following anything yet. Find a <a href={href('bills/')}>bill</a> or a{' '}
        <a href={href('members/')}>member of Congress</a> and press Follow.
      </p>
    );
  }

  return (
    <div>
      {GROUPS.map((group) => {
        const list = rows.filter((r) => r.target_type === group.type);
        if (list.length === 0) return null;
        return (
          <section aria-labelledby={`g-${group.type}`}>
            <h2 id={`g-${group.type}`}>
              {group.title} <span class="muted">({list.length})</span>
            </h2>
            <ul class="list">
              {list.map((row) => (
                <li class="following-row">
                  <span>
                    {row.link ? <a href={row.link}>{row.label}</a> : row.label}
                    {row.detail && <span class="small muted"> · {row.detail}</span>}
                  </span>
                  <button type="button" onClick={() => remove(row)} aria-label={`Unfollow ${row.label}`}>
                    Unfollow
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
