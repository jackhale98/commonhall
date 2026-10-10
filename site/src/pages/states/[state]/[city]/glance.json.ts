import {
  loadCity311,
  loadCityCapital,
  loadCityMeetings,
  loadCityOfficials,
  loadCityOperating,
} from '../../../../lib/build-data';
import type { City } from '../../../../lib/cities';
import { inCurrentBudget } from '../../../../lib/city';
import { cityPaths } from '../../../../lib/city-pages';
import type { CityGlance } from '../../../../lib/glance';
import { cityHref, localOfficialHref } from '../../../../lib/paths';

export const getStaticPaths = () => cityPaths();

/** A city at a glance for a signed-in visitor's home page: next meetings, 311 by district, the budget, councilors. */
export async function GET({ props }: { props: { city: City } }) {
  const { city } = props;
  const [meetings, report, operating, capital, officials] = await Promise.all([
    loadCityMeetings(city.key),
    loadCity311(city.key),
    loadCityOperating(city.key),
    loadCityCapital(city.key),
    loadCityOfficials(city.key),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const next = (committee: boolean) => {
    const m = meetings
      .filter((x) => x.date >= today && x.status !== 'Cancelled' && x.committees.length > 0 === committee)
      .at(-1);
    return m
      ? { date: m.date, time: m.time, location: m.location, committees: m.committees, agenda_url: m.agenda_url }
      : null;
  };
  const projects = capital ? capital.projects.filter((p) => inCurrentBudget(p, capital)) : [];
  const glance: CityGlance = {
    key: city.key,
    name: city.name,
    council: city.council,
    session: city.committeeSession,
    href: cityHref(city),
    council_href: cityHref(city, 'council/'),
    committees_href: cityHref(city, 'committees/'),
    budget_href: cityHref(city, 'budget/'),
    neighborhoods_href: cityHref(city, 'neighborhoods/'),
    next_council: next(false),
    next_committee: next(true),
    report311: report
      ? {
          ...report,
          city: { ...report.city, top: report.city.top.slice(0, 3) },
          districts: Object.fromEntries(
            Object.entries(report.districts).map(([d, s]) => [d, { ...s, top: s.top.slice(0, 3) }]),
          ),
        }
      : null,
    operating: operating
      ? {
          fiscalYear: operating.fiscalYear,
          stage: operating.stage,
          total: operating.total,
          prev: operating.prev,
          prevLabel: operating.prevLabel,
          propertyTaxShare:
            operating.revenueTotal > 0
              ? (operating.revenue.find((r) => /property tax/i.test(r.label))?.value ?? 0) / operating.revenueTotal
              : null,
        }
      : null,
    capital: capital
      ? {
          name: capital.name,
          yearLabel: capital.yearLabel,
          thisYear: projects.reduce((n, p) => n + p.thisYear, 0),
          projects: projects.length,
        }
      : null,
    councilors: officials.map((o) => ({
      name: o.name,
      district: o.district,
      seat: o.seat,
      title: o.title,
      photo_url: o.photo_url,
      href: localOfficialHref(o.id),
    })),
  };
  return new Response(JSON.stringify(glance), { headers: { 'content-type': 'application/json' } });
}
