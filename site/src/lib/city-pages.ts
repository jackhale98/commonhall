/**
 * Shared by every city's pages: the static paths (one per registered city) and the
 * tab row, which shows a tab only when the city has data behind it.
 */
import {
  loadCity311,
  loadCityCapital,
  loadCityCommittees,
  loadCityOperating,
  loadZbaAppeals,
  loadZbaDecisionCounts,
} from './build-data';
import { CITY_LIST, type City } from './cities';
import { cityHref } from './paths';

export type CityTab = 'overview' | 'council' | 'committees' | 'neighborhoods' | 'budget';

/** getStaticPaths for a city page: every registered city, or only those with the given tab. */
export async function cityPaths(tab?: CityTab) {
  const cities = [];
  for (const city of CITY_LIST) if (!tab || (await cityTabs(city)).has(tab)) cities.push(city);
  return cities.map((city) => ({ params: { state: city.state.toLowerCase(), city: city.slug }, props: { city } }));
}

/** Which tabs a city has: Overview and Council always; the rest when there is data. */
export async function cityTabs(city: City): Promise<Set<CityTab>> {
  const [committees, report, appeals, decisions, operating, capital] = await Promise.all([
    loadCityCommittees(city.key),
    loadCity311(city.key),
    loadZbaAppeals(city.key),
    loadZbaDecisionCounts(city.key),
    loadCityOperating(city.key),
    loadCityCapital(city.key),
  ]);
  const tabs = new Set<CityTab>(['overview', 'council']);
  if (committees.length) tabs.add('committees');
  if (report || appeals.length || decisions.length) tabs.add('neighborhoods');
  if (operating || capital) tabs.add('budget');
  return tabs;
}

const LABELS: [CityTab, string, string][] = [
  ['overview', 'Overview', ''],
  ['council', 'Council', 'council/'],
  ['committees', 'Committees', 'committees/'],
  ['neighborhoods', 'Neighborhoods', 'neighborhoods/'],
  ['budget', 'Budget', 'budget/'],
];

export async function cityTabRow(city: City, current: CityTab) {
  const has = await cityTabs(city);
  return LABELS.filter(([key]) => has.has(key)).map(([key, label, sub]) => ({
    label,
    href: cityHref(city, sub),
    current: key === current,
  }));
}
