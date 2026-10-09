import {
  loadCommitteeMeetings,
  loadExecutiveOrders,
  loadNominations,
  loadPrerenderLocalMatters,
  loadScotusCases,
  loadCommittees,
  loadDiscussions,
  loadLocalOfficials,
  loadMembers,
  loadPrerenderBills,
  loadPrerenderStateBills,
} from '../lib/build-data';
import {
  billDisplayTitle,
  billNumberLabel,
  formatDate,
  LEGISLATURE_STATES,
  memberRole,
  STATE_CODES,
  stateName,
} from '../lib/format';
import { NOMINATION_STATUS, nominationUrl, splitNomination } from '../lib/executive';
import {
  billHref,
  discussionHref,
  executiveOrderHref,
  href,
  localMatterHref,
  localOfficialHref,
  memberHref,
  scotusCaseHref,
  stateBillHref,
  stateHref,
} from '../lib/paths';

/** One entry in the search palette's index. Short keys keep the file small. */
export interface SearchEntry {
  /** kind */
  k:
    | 'page'
    | 'member'
    | 'committee'
    | 'state'
    | 'councilor'
    | 'discussion'
    | 'bill'
    | 'state-bill'
    | 'order'
    | 'case'
    | 'hearing'
    | 'nomination'
    | 'matter';
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
  const [
    members,
    officials,
    discussions,
    bills,
    stateBills,
    committees,
    orders,
    cases,
    meetings,
    nominations,
    matters,
  ] = await Promise.all([
    loadMembers(),
    loadLocalOfficials(),
    loadDiscussions(),
    loadPrerenderBills(),
    loadPrerenderStateBills(),
    loadCommittees(),
    loadExecutiveOrders(),
    loadScotusCases(),
    loadCommitteeMeetings(),
    loadNominations(),
    loadPrerenderLocalMatters(),
  ]);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const chamberName = (code: string) => (code.startsWith('h') ? 'House' : code.startsWith('s') ? 'Senate' : 'Joint');
  const entries: SearchEntry[] = [
    { k: 'page', t: 'Bills', s: 'Search and filter every bill', h: href('bills/') },
    { k: 'page', t: 'Votes', s: 'Every House and Senate roll call', h: href('votes/') },
    { k: 'page', t: 'Members of Congress', s: 'Senators and representatives', h: href('members/') },
    { k: 'page', t: 'Committees', s: 'Committees, hearings and markups', h: href('committees/') },
    { k: 'page', t: 'Executive orders and nominations', s: 'The executive branch', h: href('executive/') },
    { k: 'page', t: 'Supreme Court', s: 'Decisions of the last five terms', h: href('court/') },
    ...[...committees.values()].map((c) => {
      const parent = c.parent_code ? committees.get(c.parent_code) : undefined;
      return {
        k: 'committee' as const,
        t: parent ? `Subcommittee on ${c.name}` : c.name,
        s: parent
          ? parent.name
          : `${c.chamber === 'joint' ? 'Joint' : c.chamber === 'house' ? 'House' : 'Senate'} committee`,
        h: href(`committees/${c.code}/`),
      };
    }),
    { k: 'page', t: 'Boston', s: 'City Council, councilors, district map, meetings', h: href('boston/') },
    {
      k: 'page',
      t: 'Boston 311 and zoning',
      s: '311 requests by district, zoning hearings',
      h: href('boston/neighborhoods/'),
    },
    { k: 'page', t: 'Boston Capital Plan', s: 'What the city plans to build, by project', h: href('boston/budget/') },
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
    ...orders.map((o) => ({
      k: 'order' as const,
      t: clip(o.title),
      s: `${o.eo_number ? `EO ${o.eo_number} · ` : ''}${o.president_name ?? ''} · ${formatDate(o.signing_date ?? o.publication_date)}`,
      h: executiveOrderHref(o.document_number),
    })),
    ...cases.map((c) => ({
      k: 'case' as const,
      t: clip(c.case_name),
      s: `Supreme Court · ${formatDate(c.date_filed)}${c.docket_number ? ` · No. ${c.docket_number}` : ''}`,
      h: scotusCaseHref(c.cluster_id),
    })),
    // Hearings and markups from the past year and everything scheduled.
    ...meetings
      .filter((m) => m.date && m.date >= yearAgo && m.title)
      .map((m) => ({
        k: 'hearing' as const,
        t: clip(m.title!),
        s: `${m.committee_names[0] ?? (m.committee_codes[0] ? chamberName(m.committee_codes[0]) : 'Committee')} · ${m.meeting_type ?? 'Meeting'} · ${formatDate(m.date)}`,
        h: m.url,
      })),
    ...nominations
      .filter((n) => !n.is_military)
      .slice(0, 2000)
      .map((n) => {
        const split = n.description ? splitNomination(n.description) : { name: null, position: null };
        const position = n.position ?? split.position;
        return {
          k: 'nomination' as const,
          t: clip(n.nominee ?? split.name ?? n.description ?? n.citation),
          s: `${position ? `${clip(position, 70)} · ` : ''}${NOMINATION_STATUS[n.status].label}`,
          h: nominationUrl(n),
        };
      }),
    ...matters.slice(0, 1000).map(({ matter: m }) => ({
      k: 'matter' as const,
      t: clip(m.title),
      s: `Boston${m.file_number ? ` · Docket #${m.file_number}` : ''}${m.type ? ` · ${m.type.replace(/^Council /, '')}` : ''}`,
      h: localMatterHref(m.id),
    })),
  ];
  return new Response(JSON.stringify(entries), { headers: { 'content-type': 'application/json' } });
}
