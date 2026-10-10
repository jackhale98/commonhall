/**
 * The site's main navigation: sections grouped by level of government. A group
 * with items opens a small menu in the header and shows its items as a row of
 * tabs on its pages; the rest are single links. Which group and item a page
 * belongs to comes from its path, so pages don't have to declare it.
 */

export interface NavItem {
  key: string;
  label: string;
  /** Link target, relative to the site root. */
  path: string;
  /** Path prefixes (relative to the site root, no leading slash) that belong to this item. */
  match: string[];
}

export interface NavGroup {
  key: string;
  label: string;
  /** A single link when the group has no items. */
  path?: string;
  items?: NavItem[];
  match?: string[];
  /** Items lead into one another (a trail) rather than being siblings. */
  trail?: boolean;
  /** Feed and account: icons in the header on wide screens, menu entries on small ones. */
  personal?: boolean;
}

export const NAV: NavGroup[] = [
  {
    key: 'congress',
    label: 'Congress',
    items: [
      { key: 'bills', label: 'Bills', path: 'bills/', match: ['bills/', 'bill/'] },
      { key: 'members', label: 'Members', path: 'members/', match: ['members/', 'member/'] },
      { key: 'votes', label: 'Votes', path: 'votes/', match: ['votes/', 'vote/'] },
      { key: 'committees', label: 'Committees', path: 'committees/', match: ['committees/'] },
    ],
  },
  { key: 'executive', label: 'Executive', path: 'executive/', match: ['executive/'] },
  { key: 'court', label: 'Court', path: 'court/', match: ['court/'] },
  {
    key: 'local',
    label: 'States & local',
    trail: true,
    items: [
      // More specific first: Massachusetts pages also start with states/.
      { key: 'ma', label: 'Massachusetts', path: 'states/ma/', match: ['states/ma/'] },
      { key: 'boston', label: 'Boston', path: 'boston/', match: ['boston/'] },
      {
        key: 'states',
        label: 'All states',
        path: 'states/',
        match: ['states/', 'state-bill/', 'state-legislator/', 'state-committee/'],
      },
    ],
  },
  { key: 'discuss', label: 'Discuss', path: 'discussions/', match: ['discussions/', 'discussion/'] },
  { key: 'feed', label: 'Feed', path: 'feed/', match: ['feed/', 'following/'], personal: true },
  { key: 'account', label: 'Account', path: 'account/', match: ['account/'], personal: true },
];

/** Items in reading order (the trail runs All states › Massachusetts › Boston). */
export function orderedItems(group: NavGroup): NavItem[] {
  const items = group.items ?? [];
  if (group.key !== 'local') return items;
  const by = new Map(items.map((i) => [i.key, i]));
  return ['states', 'ma', 'boston'].map((k) => by.get(k)!).filter(Boolean);
}

/** The group and item a page belongs to, from its path relative to the site root. */
export function activeNav(path: string): { group?: NavGroup; item?: NavItem } {
  const p = path.replace(/^\/+/, '');
  const hit = (prefixes: string[] = []) => prefixes.some((m) => p === m.replace(/\/$/, '') || p.startsWith(m));
  for (const group of NAV) {
    const item = group.items?.find((i) => hit(i.match));
    if (item) return { group, item };
    if (hit(group.match)) return { group };
  }
  return {};
}

/**
 * The phone menu: every page under a heading, one link per row, all the same size.
 * Keys match NAV's item and group keys, so the current page is marked the same way.
 */
export const PHONE_NAV: { heading: string; items: { key: string; label: string; path: string }[] }[] = [
  {
    heading: 'Congress',
    items: [
      { key: 'bills', label: 'Bills', path: 'bills/' },
      { key: 'members', label: 'Members', path: 'members/' },
      { key: 'votes', label: 'Votes', path: 'votes/' },
      { key: 'committees', label: 'Committees', path: 'committees/' },
    ],
  },
  {
    heading: 'White House and courts',
    items: [
      { key: 'executive', label: 'Executive orders and nominations', path: 'executive/' },
      { key: 'court', label: 'Supreme Court', path: 'court/' },
    ],
  },
  {
    heading: 'States & local',
    items: [
      { key: 'states', label: 'All states', path: 'states/' },
      { key: 'ma', label: 'Massachusetts', path: 'states/ma/' },
      { key: 'boston', label: 'Boston', path: 'boston/' },
    ],
  },
  {
    heading: 'Take part',
    items: [
      { key: 'discuss', label: 'Discussions', path: 'discussions/' },
      { key: 'feed', label: 'Your feed', path: 'feed/' },
      { key: 'account', label: 'Account', path: 'account/' },
    ],
  },
];
