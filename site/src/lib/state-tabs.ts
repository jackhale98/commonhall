/**
 * A state's pages, as tabs: Overview, Legislature (state lawmakers), Bills,
 * Committees, Congress (its members of Congress) and Local (cities we cover).
 * Tabs with nothing behind them are left out: territories have no legislature,
 * and Local appears only where we cover a city.
 */
import { citiesIn } from './cities';
import { href, stateHref } from './paths';

export type StateTab =
  'overview' | 'legislature' | 'bills' | 'committees' | 'governor' | 'courts' | 'congress' | 'local';

/** A state's high court, by CourtListener court id. */
export const STATE_COURT_NAMES: Record<string, string> = { mass: 'Supreme Judicial Court' };

export interface StateTabCounts {
  legislature: boolean;
  legislators: number;
  committees: number;
  congress: number;
  /** Governor's orders and high court decisions on file. */
  orders: number;
  cases: number;
}

export function stateTabs(code: string, current: StateTab, counts: StateTabCounts) {
  const base = `states/${code.toLowerCase()}/`;
  const tabs: { key: StateTab; label: string; href: string; count?: number; show: boolean }[] = [
    { key: 'overview', label: 'Overview', href: stateHref(code), show: true },
    {
      key: 'legislature',
      label: 'Legislature',
      href: href(`${base}legislature/`),
      count: counts.legislators || undefined,
      show: counts.legislature,
    },
    { key: 'bills', label: 'Bills', href: href(`${base}bills/`), show: counts.legislature },
    {
      key: 'committees',
      label: 'Committees',
      href: href(`${base}committees/`),
      count: counts.committees,
      show: counts.legislature && counts.committees > 0,
    },
    { key: 'governor', label: 'Governor', href: href(`${base}governor/`), show: counts.orders > 0 },
    { key: 'courts', label: 'Courts', href: href(`${base}courts/`), show: counts.cases > 0 },
    { key: 'congress', label: 'Congress', href: href(`${base}congress/`), count: counts.congress, show: true },
    { key: 'local', label: 'Local', href: href(`${base}local/`), show: citiesIn(code).length > 0 },
  ];
  return tabs
    .filter((t) => t.show)
    .map(({ key, label, href: h, count }) => ({ label, href: h, count, current: key === current }));
}

interface ChamberPerson {
  id: string;
  name: string;
  party: string | null;
  chamber: string | null;
  district: string | null;
  openstates_url?: string | null;
}

const districtSort = (a: ChamberPerson, b: ChamberPerson) =>
  (Number(a.district) || 0) - (Number(b.district) || 0) ||
  (a.district ?? '').localeCompare(b.district ?? '') ||
  a.name.localeCompare(b.name);

/** A legislature's chambers with their members in district order (DC's council and Nebraska's one house included). */
export function legislatureChambers<T extends ChamberPerson>(
  code: string,
  people: T[],
  label: (chamber: 'upper' | 'lower' | 'legislature') => string,
) {
  return (['upper', 'lower', 'legislature'] as const)
    .map((key) => ({
      key,
      label: code === 'DC' && key !== 'lower' ? 'Council' : key === 'legislature' ? 'Legislature' : label(key),
      people: people.filter((p) => p.chamber === key).sort(districtSort),
    }))
    .filter((c) => c.people.length > 0);
}

/** Seats by party for a hemicycle: Democrats, others, Republicans. */
export function partyGroups(people: { party: string | null }[]) {
  const n = { D: 0, I: 0, R: 0 };
  for (const p of people) {
    const k = (p.party ?? '').charAt(0);
    n[k === 'D' || k === 'R' ? k : 'I'] += 1;
  }
  return [
    { label: 'Democrats', seats: n.D, tone: 'fill-party-d' },
    { label: 'Other', seats: n.I, tone: 'fill-party-i' },
    { label: 'Republicans', seats: n.R, tone: 'fill-party-r' },
  ];
}

/** A state's legislators as list rows (Legislature tab, legislators.json), chamber by chamber. */
export function legislatorRows(
  code: string,
  legislators: (ChamberPerson & {
    id: string;
    name: string;
    party: string | null;
    district: string | null;
    openstates_url: string | null;
    photo_url: string | null;
  })[],
  label: (chamber: 'upper' | 'lower' | 'legislature') => string,
) {
  return legislatureChambers(code, legislators, label).flatMap((c) =>
    c.people.map((l) => ({
      id: l.id,
      name: l.name,
      party: l.party,
      district: l.district,
      chamber: c.key as string,
      url: l.openstates_url,
      photo_url: l.photo_url,
    })),
  );
}
