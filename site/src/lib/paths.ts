import { DEMO } from './config';
import { CITIES, cityOf, idWithinCity, type City } from './cities';

/** Base-aware internal links (the site may live under /<repo>/ on GitHub Pages). */
const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

export function href(path = ''): string {
  return `${BASE}${path.replace(/^\//, '')}`;
}

export function billHref(congress: number, type: string, number: number | string): string {
  return href(`bills/${congress}/${type.toLowerCase()}/${number}/`);
}

/** Client-rendered fallback route for bills newer than the last build or from older Congresses. */
export function billFallbackHref(id: string): string {
  return href(`bill/?id=${encodeURIComponent(id)}`);
}

export function memberHref(bioguideId: string): string {
  return href(`members/${bioguideId}/`);
}

/** Votes are client-rendered from Supabase; in demo mode they are prerendered. */
export function voteHref(id: string): string {
  return DEMO ? href(`votes/${id}/`) : href(`vote/?id=${encodeURIComponent(id)}`);
}

export function stateHref(state: string): string {
  return href(`states/${state.toLowerCase()}/`);
}

/** Boston council matters use the Legistar MatterId in their URL. */
/** An executive order's page, by Federal Register document number. */
export function executiveOrderHref(documentNumber: string): string {
  return href(`executive/orders/${documentNumber}/`);
}

/** A Supreme Court decision's page, by CourtListener cluster id. */
export function scotusCaseHref(clusterId: string | number): string {
  return href(`court/cases/${clusterId}/`);
}

/** A city's pages: states/ma/boston/ plus an optional sub-path ("council/"). */
export function cityHref(city: City | string, sub = ''): string {
  const c = typeof city === 'string' ? CITIES[city] : city;
  if (!c) return href('states/');
  return href(`states/${c.state.toLowerCase()}/${c.slug}/${sub}`);
}

/** A page for something that belongs to a city, by its id ("ma-boston-p324" → …/councilors/p324/). */
function withinCity(id: string, section: string): string {
  const city = cityOf(id);
  return city ? cityHref(city, `${section}/${encodeURIComponent(idWithinCity(id))}/`) : href('states/');
}

/** A capital project's page: ma-boston-{the city's project id}, ma-worcester-{slug}. */
export function capitalProjectHref(id: string): string {
  return withinCity(id, 'projects');
}

/** A council matter's prerendered page. */
export function localMatterHref(id: string): string {
  return withinCity(id, 'matters');
}

/** A council matter's page built in the browser (any matter, prerendered or not). */
export function localMatterFallbackHref(id: string): string {
  const city = cityOf(id);
  return city ? cityHref(city, `matter/?id=${encodeURIComponent(idWithinCity(id))}`) : href('states/');
}

/** A council committee's page, by its city and slug. */
export function localCommitteeHref(city: City | string, slug: string): string {
  return cityHref(city, `committees/${slug}/`);
}

/** A councilor's page. */
export function localOfficialHref(id: string): string {
  return withinCity(id, 'councilors');
}

/** "H 1234" → "h-1234"; "194th" → "194th". */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Clean URL for a state bill: /states/ma/bills/194th/h-1234/. */
export function stateBillHref(state: string, session: string, identifier: string): string {
  return href(`states/${state.toLowerCase()}/bills/${slug(session)}/${slug(identifier)}/`);
}

export function stateBillFallbackHref(id: string): string {
  return href(`state-bill/?id=${encodeURIComponent(id)}`);
}

/** State legislators and committees are client-rendered pages keyed by Open States id. */
export function stateLegislatorHref(id: string): string {
  return href(`state-legislator/?id=${encodeURIComponent(id)}`);
}

export function stateCommitteeHref(id: string): string {
  return href(`state-committee/?id=${encodeURIComponent(id)}`);
}

export function discussionHref(id: string): string {
  return href(`discussions/${id}/`);
}

/** Official page for a Massachusetts bill, e.g. https://malegislature.gov/Bills/194/H1234. */
export function maLegislatureUrl(session: string, identifier: string): string | null {
  const court = /^(\d+)/.exec(session)?.[1];
  const bill = identifier.replace(/\s+/g, '').toUpperCase();
  if (!court || !/^[HS]D?\d+$/.test(bill)) return null;
  return `https://malegislature.gov/Bills/${court}/${bill}`;
}
