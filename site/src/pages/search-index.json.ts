import {
  loadDiscussions,
  loadLocalOfficials,
  loadMembers,
  loadPrerenderBills,
  loadPrerenderStateBills,
} from '../lib/build-data';
import {
  billDisplayTitle,
  billNumberLabel,
  LEGISLATURE_STATES,
  memberRole,
  STATE_CODES,
  stateName,
} from '../lib/format';
import { billHref, discussionHref, href, localOfficialHref, memberHref, stateBillHref, stateHref } from '../lib/paths';

/** One entry in the search palette's index. Short keys keep the file small. */
export interface SearchEntry {
  /** kind */
  k: 'page' | 'member' | 'state' | 'councilor' | 'discussion' | 'bill' | 'state-bill';
  /** title */
  t: string;
  /** subtitle */
  s: string;
  /** href */
  h: string;
}

const MAX_BILLS = 1500;
const clip = (text: string, n = 110) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** Everything the header search can find instantly; full bill search goes to /bills/?q=. */
export async function GET() {
  const [members, officials, discussions, bills, stateBills] = await Promise.all([
    loadMembers(),
    loadLocalOfficials(),
    loadDiscussions(),
    loadPrerenderBills(),
    loadPrerenderStateBills(),
  ]);
  const entries: SearchEntry[] = [
    { k: 'page', t: 'Bills', s: 'Search and filter every bill', h: href('bills/') },
    { k: 'page', t: 'Votes', s: 'Every House and Senate roll call', h: href('votes/') },
    { k: 'page', t: 'Members of Congress', s: 'Senators and representatives', h: href('members/') },
    { k: 'page', t: 'Boston City Council', s: 'Councilors, district map, meetings', h: href('boston/') },
    { k: 'page', t: 'Discussions', s: 'Have your say', h: href('discussions/') },
    ...STATE_CODES.map((code) => ({
      k: 'state' as const,
      t: stateName(code),
      s: LEGISLATURE_STATES.includes(code) ? `${code} · delegation, legislature and bills` : `${code} · delegation`,
      h: stateHref(code),
    })),
    ...[...members.values()]
      .filter((m) => m.current)
      .map((m) => ({
        k: 'member' as const,
        t: m.name,
        s: `${(m.party ?? '').charAt(0)} · ${memberRole(m)}`,
        h: memberHref(m.bioguide_id),
      })),
    ...officials.map((o) => ({
      k: 'councilor' as const,
      t: o.name,
      s: `Boston City Council · ${o.seat ?? 'Councilor'}`,
      h: localOfficialHref(o.id),
    })),
    ...discussions.map((d) => ({ k: 'discussion' as const, t: d.title, s: 'Discussion', h: discussionHref(d.id) })),
    ...bills.slice(0, MAX_BILLS).map((b) => ({
      k: 'bill' as const,
      t: clip(billDisplayTitle(b)),
      s: billNumberLabel(b),
      h: billHref(b.congress, b.bill_type, b.number),
    })),
    ...stateBills.slice(0, 500).map((b) => ({
      k: 'state-bill' as const,
      t: clip(b.title),
      s: `${b.state} ${b.identifier}`,
      h: stateBillHref(b.state, b.session, b.identifier),
    })),
  ];
  return new Response(JSON.stringify(entries), { headers: { 'content-type': 'application/json' } });
}
