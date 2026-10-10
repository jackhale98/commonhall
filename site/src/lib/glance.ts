/** The shape of a city's glance.json (built with the site), read by the home page for a signed-in visitor. */
import type { Report311 } from './local';

export interface GlanceMeeting {
  date: string;
  time: string | null;
  location: string | null;
  committees: string[];
  agenda_url: string | null;
}

export interface CityGlance {
  key: string;
  name: string;
  council: string;
  session: 'hearing' | 'meeting';
  href: string;
  council_href: string;
  committees_href: string;
  budget_href: string;
  neighborhoods_href: string;
  next_council: GlanceMeeting | null;
  next_committee: GlanceMeeting | null;
  /** Top three request types only. */
  report311: Report311 | null;
  operating: {
    fiscalYear: number;
    stage: 'proposed' | 'adopted';
    total: number;
    prev: number;
    prevLabel: string;
    propertyTaxShare: number | null;
  } | null;
  capital: { name: string; yearLabel: string; thisYear: number; projects: number } | null;
  councilors: {
    name: string;
    district: number | null;
    seat: string | null;
    title: string | null;
    photo_url: string | null;
    href: string;
  }[];
}
