import { useEffect, useState } from 'preact/hooks';
import { billLabel } from '@civic/congress-client/ids';
import { followedIds, hasStoredSession } from '../lib/auth';
import { matterLabel } from '../lib/cities';
import { formatDate } from '../lib/format';
import { billHref, href, localMatterFallbackHref, stateBillFallbackHref } from '../lib/paths';
import { inList, select } from '../lib/rest';

interface Item {
  id: string;
  label: string;
  title: string;
  date: string | null;
  action: string | null;
  href: string;
}

type Kind = { type: 'bill' } | { type: 'state_bill'; state: string } | { type: 'local_matter'; city: string };

/** The visitor's follows of one kind, as list rows, newest action first. */
async function load(kind: Kind): Promise<Item[]> {
  let ids = await followedIds(kind.type);
  if (kind.type === 'local_matter') ids = ids.filter((id) => id.startsWith(`${kind.city}-`));
  if (!ids.length) return [];
  const byId = { id: inList(ids.slice(0, 200)), order: 'latest_action_date.desc.nullslast' };
  if (kind.type === 'bill') {
    const rows = await select<{
      id: string;
      congress: number;
      bill_type: string;
      number: number;
      title: string;
      short_title: string | null;
      latest_action_date: string | null;
      latest_action_text: string | null;
    }>('bills', {
      select: 'id,congress,bill_type,number,title,short_title,latest_action_date,latest_action_text',
      ...byId,
    });
    return rows.map((b) => ({
      id: b.id,
      label: billLabel(b.bill_type, b.number),
      title: b.short_title ?? b.title,
      date: b.latest_action_date,
      action: b.latest_action_text,
      href: billHref(b.congress, b.bill_type, b.number),
    }));
  }
  if (kind.type === 'state_bill') {
    const rows = await select<{
      id: string;
      state: string;
      identifier: string;
      title: string;
      latest_action_date: string | null;
      latest_action_text: string | null;
    }>('state_bills', {
      select: 'id,state,identifier,title,latest_action_date,latest_action_text',
      state: `eq.${kind.state}`,
      ...byId,
    });
    return rows.map((b) => ({
      id: b.id,
      label: `${b.state} ${b.identifier}`,
      title: b.title,
      date: b.latest_action_date,
      action: b.latest_action_text,
      href: stateBillFallbackHref(b.id),
    }));
  }
  const rows = await select<{
    id: string;
    matter_id: number;
    file_number: string | null;
    title: string;
    latest_action_date: string | null;
    latest_action_text: string | null;
  }>('local_matters', { select: 'id,matter_id,file_number,title,latest_action_date,latest_action_text', ...byId });
  return rows.map((m) => ({
    id: m.id,
    label: matterLabel(m),
    title: m.title,
    date: m.latest_action_date,
    action: m.latest_action_text,
    href: localMatterFallbackHref(m.id),
  }));
}

/**
 * Above a list of bills or council matters: the ones the signed-in visitor follows,
 * with their latest action. Reads only the visitor's own follows; nothing when
 * signed out or following none here.
 */
export default function FollowedItems({ kind, title }: { kind: Kind; title: string }) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    if (!hasStoredSession()) return;
    load(kind)
      .then(setItems)
      .catch(() => undefined);
  }, []);
  if (!items.length) return null;
  return (
    <section class="your-followed panel" aria-labelledby={`followed-${kind.type}-h`}>
      <div class="section-head">
        <h2 id={`followed-${kind.type}-h`} class="h-small">
          {title}
        </h2>
        <a class="see-all" href={href('following/')}>
          All you follow
        </a>
      </div>
      <ul class="followed-items">
        {items.map((i) => (
          <li key={i.id}>
            <span class="small muted">{i.label}</span>
            <a href={i.href}>{i.title}</a>
            {i.action && (
              <span class="small muted">
                {i.date && `${formatDate(i.date)}: `}
                {i.action}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
