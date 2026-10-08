/** Data shaping for the site's charts (pure functions, used at build time and in islands). */
import type { BarItem } from '../components/viz/BarList';
import type { SeatGroup } from '../components/viz/Hemicycle';
import type { Segment } from '../components/viz/StackedBar';
import { LEGISLATURE_STATES } from './format';
import { href } from './paths';

const VOTING_STATES = LEGISLATURE_STATES.filter((c) => c !== 'DC');
const SEATS = { house: 435, senate: 100 } as const;

interface SeatMember {
  current: boolean;
  chamber: 'house' | 'senate' | null;
  party: string | null;
  state: string | null;
}

/** Seats by party for a chamber, with vacancies. Delegates and the resident commissioner are not counted. */
export function chamberGroups(members: Iterable<SeatMember>, chamber: 'house' | 'senate'): SeatGroup[] {
  const counts = { D: 0, I: 0, R: 0 };
  for (const m of members) {
    if (!m.current || m.chamber !== chamber || !m.state || !VOTING_STATES.includes(m.state)) continue;
    const p = (m.party ?? '').charAt(0) as keyof typeof counts;
    counts[p in counts ? p : 'I'] += 1;
  }
  const filled = counts.D + counts.I + counts.R;
  return [
    { label: 'Democrats', seats: counts.D, tone: 'fill-party-d' },
    { label: 'Independents', seats: counts.I, tone: 'fill-party-i' },
    { label: 'Vacant', seats: Math.max(0, SEATS[chamber] - filled), tone: 'fill-vacant' },
    { label: 'Republicans', seats: counts.R, tone: 'fill-party-r' },
  ];
}

const STAGES: { label: string; statuses: string[] }[] = [
  { label: 'Introduced', statuses: ['introduced'] },
  { label: 'In committee', statuses: ['in_committee'] },
  { label: 'Passed one chamber', statuses: ['passed_house', 'passed_senate'] },
  { label: 'Passed both chambers', statuses: ['passed_both'] },
  { label: 'Sent to the President', statuses: ['to_president'] },
  { label: 'Became law', statuses: ['law'] },
  { label: 'Vetoed', statuses: ['vetoed'] },
];

/** How far a status has got, 0 (introduced) to 1 (law), for progress meters. */
export function statusProgress(status: string): number {
  const order = ['introduced', 'in_committee', 'passed_house', 'passed_senate', 'passed_both', 'to_president', 'law'];
  if (status === 'agreed' || status === 'law') return 1;
  if (status === 'vetoed') return 5 / 6;
  const i = order.indexOf(status);
  return i < 0 ? 0 : [0.08, 0.2, 0.45, 0.45, 0.7, 0.85, 1][i]!;
}

/** Bills (not simple resolutions) by stage, each linking to the filtered bill list. */
export function pipeline(bills: { status: string; bill_type: string }[]): BarItem[] {
  const laws = bills.filter((b) => ['hr', 's', 'hjres', 'sjres'].includes(b.bill_type));
  return STAGES.map((stage) => ({
    label: stage.label,
    value: laws.filter((b) => stage.statuses.includes(b.status)).length,
    href: href(`bills/?status=${stage.statuses[0]}`),
  })).filter((s) => s.value > 0 || s.label !== 'Vetoed');
}

/** Most common policy areas. */
export function topPolicyAreas(bills: { policy_area: string | null }[], n = 8): BarItem[] {
  const counts = new Map<string, number>();
  for (const b of bills) if (b.policy_area) counts.set(b.policy_area, (counts.get(b.policy_area) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, value]) => ({ label, value, href: href(`bills/?policy=${encodeURIComponent(label)}`) }));
}

export function voteSegments(v: {
  yea_total: number;
  nay_total: number;
  present_total?: number;
  not_voting_total?: number;
}): Segment[] {
  return [
    { label: 'Yea', value: v.yea_total, tone: 'fill-yea' },
    { label: 'Nay', value: v.nay_total, tone: 'fill-nay' },
    { label: 'Present', value: v.present_total ?? 0, tone: 'fill-present' },
    { label: 'Not voting', value: v.not_voting_total ?? 0, tone: 'fill-nv' },
  ];
}

export function partySegments(counts: Record<string, number>): Segment[] {
  return [
    { label: 'Democrats', value: counts.D ?? 0, tone: 'fill-party-d' },
    { label: 'Independents', value: counts.I ?? 0, tone: 'fill-party-i' },
    { label: 'Republicans', value: counts.R ?? 0, tone: 'fill-party-r' },
  ];
}
