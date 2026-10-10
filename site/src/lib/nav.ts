/**
 * The site's main navigation: sections grouped by level of government. A group
 * with items opens a small menu in the header and shows its items as a row of
 * tabs on its pages; the rest are single links. Which group and item a page
 * belongs to comes from its path, so pages don't have to declare it.
 */
import { CITY_LIST } from './cities';
import { stateName } from './format';

/** Each city we cover: a menu item under States & local, keyed by its city key. */
const CITY_ITEMS: NavItem[] = CITY_LIST.map((c) => {
  const path = `states/${c.state.toLowerCase()}/${c.slug}/`;
  return { key: c.key, label: c.name, path, match: [path] };
});

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
  { key: 'court', label: 'Supreme Court', path: 'court/', match: ['court/'] },
  {
    key: 'local',
    label: 'States & local',
    trail: true,
    items: [
      // More specific first: a city's pages start with its state's path, and Massachusetts' with states/.
      ...CITY_ITEMS,
      { key: 'ma', label: 'Massachusetts', path: 'states/ma/', match: ['states/ma/'] },
      {
        key: 'states',
        label: 'All states',
        path: 'states/',
        match: ['states/', 'state-bill/', 'state-legislator/', 'state-committee/'],
      },
    ],
  },
  { key: 'reps', label: 'Your reps', path: 'reps/', match: ['reps/'] },
  { key: 'discuss', label: 'Discuss', path: 'discussions/', match: ['discussions/', 'discussion/'] },
  { key: 'feed', label: 'Feed', path: 'feed/', match: ['feed/', 'following/'], personal: true },
  { key: 'account', label: 'Account', path: 'account/', match: ['account/'], personal: true },
];

/**
 * The States & local trail under the header, which follows where you are:
 * "All states › Delaware" on a state's pages, "All states › Massachusetts › Boston"
 * on a city's. It only leads back up: a state's own pages end at the state, and
 * its cities are on its Local tab. Empty on the all-states page itself and on pages
 * that only learn their state in the browser; those carry their own breadcrumb.
 */
export function localTrail(path: string): NavItem[] {
  const p = path.replace(/^\/+/, '');
  const local = NAV.find((g) => g.key === 'local')!;
  const { item } = activeNav(p);
  const by = new Map((local.items ?? []).map((i) => [i.key, i]));
  const all = by.get('states')!;
  const state = /^states\/([a-z]{2})(\/|$)/.exec(p)?.[1];
  if (!state) return [];
  const stateItem = by.get(state) ?? {
    key: `state-${state}`,
    label: stateName(state),
    path: `states/${state}/`,
    match: [`states/${state}/`],
  };
  // A city's pages: All states › its state › the city.
  const city = item && CITY_ITEMS.find((c) => c.key === item.key);
  return city ? [all, stateItem, city] : [all, stateItem];
}

/** Items in reading order (the trail runs All states › Massachusetts › Boston). */
export function orderedItems(group: NavGroup): NavItem[] {
  const items = group.items ?? [];
  if (group.key !== 'local') return items;
  const by = new Map(items.map((i) => [i.key, i]));
  return ['states', 'ma', ...CITY_ITEMS.map((c) => c.key)].map((k) => by.get(k)!).filter(Boolean);
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
      ...CITY_ITEMS.map(({ key, label, path }) => ({ key, label, path })),
    ],
  },
  {
    heading: 'Take part',
    items: [
      { key: 'reps', label: 'Find your representatives', path: 'reps/' },
      { key: 'discuss', label: 'Discussions', path: 'discussions/' },
      { key: 'feed', label: 'Your feed', path: 'feed/' },
      { key: 'account', label: 'Account', path: 'account/' },
    ],
  },
];
