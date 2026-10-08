import { useEffect, useState } from 'preact/hooks';
import { onDemand } from '../lib/functions';
import { memberRole, partyClass, partyLabel } from '../lib/format';
import { select } from '../lib/rest';
import { BILL_LIST_COLUMNS, MEMBER_COLUMNS, type BillListItem as Bill, type Member } from '../lib/types';
import BillListItem from './BillListItem';
import FollowButton from './FollowButton';
import MemberPhoto from './MemberPhoto';

interface View {
  member: Member;
  sponsored: Bill[];
  source: 'database' | 'archive';
}

export default function MemberFallback() {
  const [view, setView] = useState<View | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!/^[A-Z]\d{6}$/.test(id)) {
      setState('invalid');
      return;
    }
    (async () => {
      try {
        const [member] = await select<Member>('members', { bioguide_id: `eq.${id}`, select: MEMBER_COLUMNS });
        if (member) {
          const sponsored = await select<Bill>('bills', {
            sponsor_id: `eq.${id}`,
            select: BILL_LIST_COLUMNS,
            order: 'latest_action_date.desc.nullslast',
            limit: 20,
          });
          setView({ member, sponsored, source: 'database' });
          setState('ready');
          return;
        }
        const result = await onDemand<{ member: Member; sponsored: Bill[] }>('member', id);
        if (!result.ok) {
          setMessage(result.error);
          setState('error');
          return;
        }
        setView({ ...result.payload, source: 'archive' });
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, []);

  if (state === 'loading') return <p aria-live="polite">Loading member…</p>;
  if (state === 'invalid') return <p class="notice error">That isn’t a valid member id. Ids look like A000375.</p>;
  if (state === 'error' || !view) return <p class="notice error">Couldn’t load this member. {message}</p>;

  const { member } = view;
  return (
    <article>
      <header style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', margin: '1rem 0 1.5rem' }}>
        <MemberPhoto name={member.name} url={member.photo_url} bioguideId={member.bioguide_id} size={120} />
        <div>
          <h1>{member.name}</h1>
          <p>
            <span class={`party ${partyClass(member.party)}`}>{partyLabel(member.party)}</span> · {memberRole(member)}
          </p>
          <p>
            <FollowButton targetType="member" targetId={member.bioguide_id} label={member.name} />
          </p>
          {member.website && (
            <p>
              <a href={member.website} rel="noopener">
                Official website
              </a>
            </p>
          )}
          {view.source === 'archive' && <p class="small muted">Fetched from Congress.gov on request.</p>}
        </div>
      </header>
      <h2>Recently sponsored</h2>
      {view.sponsored.length > 0 ? (
        <ul class="list">
          {view.sponsored.map((b) => (
            <BillListItem bill={b} />
          ))}
        </ul>
      ) : (
        <p class="muted">No sponsored legislation found.</p>
      )}
    </article>
  );
}
