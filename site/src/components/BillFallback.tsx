import { useEffect, useState } from 'preact/hooks';
import { parseBillId } from '@civic/congress-client/ids';
import { onDemand } from '../lib/functions';
import { billDisplayTitle, billNumberLabel, congressLabel, formatDate, paragraphs } from '../lib/format';
import { billHref } from '../lib/paths';
import { redirectIfPrerendered } from '../lib/prerendered';
import { select } from '../lib/rest';
import { BILL_PAGE_COLUMNS, type Bill, type BillAction, type Member } from '../lib/types';
import { BILL_COMMITTEE_COLUMNS, type BillCommittee } from '../lib/committees';
import ActionTimeline from './ActionTimeline';
import BillCommittees from './BillCommittees';
import DiscussionRequest from './DiscussionRequest';
import FollowButton from './FollowButton';
import MemberChip from './MemberChip';
import StatusTracker from './StatusTracker';

type MemberRef = Pick<Member, 'bioguide_id' | 'name' | 'party' | 'state' | 'district' | 'chamber'>;

interface View {
  bill: Bill;
  sponsor: MemberRef | null;
  actions: Pick<BillAction, 'seq' | 'action_date' | 'text' | 'chamber' | 'source_system'>[];
  cosponsors: { member_id: string; withdrawn_date: string | null; is_original: boolean; member: MemberRef | null }[];
  subjects: string[];
  committees?: BillCommittee[];
  source: 'database' | 'archive';
}

const MEMBER_REF = 'bioguide_id,name,party,state,district,chamber';

async function loadFromDatabase(id: string): Promise<View | null> {
  const [bill] = await select<Bill>('bills', { id: `eq.${id}`, select: BILL_PAGE_COLUMNS });
  if (!bill) return null;
  const [actions, cosponsors, subjects, sponsor, committees] = await Promise.all([
    select<View['actions'][number]>('bill_actions', {
      bill_id: `eq.${id}`,
      select: 'seq,action_date,text,chamber,source_system',
      order: 'seq.asc',
    }),
    select<View['cosponsors'][number]>('bill_cosponsors', {
      bill_id: `eq.${id}`,
      select: `member_id,withdrawn_date,is_original,member:members(${MEMBER_REF})`,
      order: 'sponsored_date.asc',
    }),
    select<{ subject: string }>('bill_subjects', { bill_id: `eq.${id}`, select: 'subject', order: 'subject.asc' }),
    bill.sponsor_id
      ? select<MemberRef>('members', { bioguide_id: `eq.${bill.sponsor_id}`, select: MEMBER_REF })
      : Promise.resolve([]),
    // Optional: older deployments may not have the table yet.
    select<BillCommittee>('bill_committees', { bill_id: `eq.${id}`, select: BILL_COMMITTEE_COLUMNS }).catch(() => []),
  ]);
  return {
    bill,
    sponsor: sponsor[0] ?? null,
    actions,
    cosponsors,
    subjects: subjects.map((s) => s.subject),
    committees,
    source: 'database',
  };
}

export default function BillFallback() {
  const [view, setView] = useState<View | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'invalid' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('id') ?? '';
    const ref = parseBillId(raw);
    if (!ref) {
      setState('invalid');
      return;
    }
    const id = `${ref.congress}-${ref.type}-${ref.number}`;
    (async () => {
      try {
        const clean = billHref(ref.congress, ref.type, ref.number);
        if (await redirectIfPrerendered((i) => (i.bills.includes(id) ? clean : null))) return;
        const fromDb = await loadFromDatabase(id);
        if (fromDb) {
          setView(fromDb);
          setState('ready');
          return;
        }
        const result = await onDemand<{
          bill: Bill;
          sponsor: MemberRef | null;
          actions: View['actions'];
          cosponsors: (View['cosponsors'][number] & { member: MemberRef })[];
          subjects: string[];
        }>('bill', id);
        if (!result.ok) {
          setMessage(result.error);
          setState(result.status === 404 ? 'missing' : 'error');
          return;
        }
        setView({ ...result.payload, source: 'archive' });
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, []);

  useEffect(() => {
    if (view)
      document.title = `${billNumberLabel(view.bill)}: ${billDisplayTitle(view.bill)} · ${document.title.split(' · ').pop()}`;
  }, [view]);

  if (state === 'loading') return <p aria-live="polite">Loading bill…</p>;
  if (state === 'invalid') return <p class="notice error">That isn’t a valid bill id. Ids look like 119-hr-1234.</p>;
  if (state === 'missing') return <p class="notice">We couldn’t find that bill. {message}</p>;
  if (state === 'error' || !view)
    return <p class="notice error">Couldn’t load this bill. {message || 'Please try again later.'}</p>;

  const { bill } = view;
  const active = view.cosponsors.filter((c) => !c.withdrawn_date);
  const summary = paragraphs(bill.summary_text);

  return (
    <article>
      <DiscussionRequest targetType="bill" targetId={bill.id} />
      <header>
        <p class="eyebrow">
          {billNumberLabel(bill)} · {congressLabel(bill.congress)}
        </p>
        <h1>{billDisplayTitle(bill)}</h1>
        {bill.short_title && bill.short_title !== bill.title && <p class="official-title">{bill.title}</p>}
        <p class="meta cluster small">
          {bill.introduced_date && <span>Introduced {formatDate(bill.introduced_date)}</span>}
          {bill.policy_area && <span>Policy area: {bill.policy_area}</span>}
          {bill.law_number && <span>Public Law {bill.law_number}</span>}
        </p>
        <div class="cluster" style={{ marginTop: '1rem' }}>
          <FollowButton targetType="bill" targetId={bill.id} label={billNumberLabel(bill)} />
          {bill.text_url && (
            <a class="button" href={bill.text_url} rel="noopener">
              Read the text
            </a>
          )}
          {bill.congress_gov_url && (
            <a class="button" href={bill.congress_gov_url} rel="noopener">
              On Congress.gov
            </a>
          )}
        </div>
        {view.source === 'archive' && (
          <p class="small muted">Fetched from Congress.gov on request; not tracked for updates.</p>
        )}
      </header>

      <section aria-label="Status" style={{ marginTop: '1.5rem' }}>
        <StatusTracker billType={bill.bill_type} status={bill.status} />
        {bill.latest_action_text && (
          <div class="latest-action">
            <h2 class="h-small">Latest action</h2>
            <p>
              {formatDate(bill.latest_action_date)}: {bill.latest_action_text}
            </p>
          </div>
        )}
      </section>

      <section>
        <h2>Summary</h2>
        {summary.length > 0 ? summary.map((p) => <p>{p}</p>) : <p class="muted">No summary yet.</p>}
      </section>

      <section>
        <h2>Sponsor and cosponsors</h2>
        <p>{view.sponsor ? <MemberChip member={view.sponsor} /> : <span class="muted">Sponsor not recorded.</span>}</p>
        {active.length > 0 ? (
          <details class="more" open={active.length <= 10}>
            <summary>{active.length} cosponsors</summary>
            <ul class="list">
              {active.map((c) => (
                <li>{c.member ? <MemberChip member={c.member} /> : c.member_id}</li>
              ))}
            </ul>
          </details>
        ) : (
          <p class="muted">No cosponsors.</p>
        )}
      </section>

      <section>
        <h2>Actions</h2>
        <ActionTimeline actions={view.actions} />
      </section>

      {(view.committees?.length ?? 0) > 0 && (
        <section>
          <h2>Committees</h2>
          <BillCommittees rows={view.committees!} />
        </section>
      )}

      {view.subjects.length > 0 && (
        <section>
          <h2>Subjects</h2>
          <p>{view.subjects.join(' · ')}</p>
        </section>
      )}
    </article>
  );
}
