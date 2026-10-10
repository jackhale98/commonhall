import { DEMO } from './config';

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

/** A Boston Capital Plan project's page, by the city's project id. */
/** A capital project's page: Boston's by the city's project id, Worcester's by worcester-{slug}. */
export function capitalProjectHref(projId: string): string {
  if (projId.startsWith('worcester-')) return href(`worcester/projects/${projId.slice('worcester-'.length)}/`);
  return href(`boston/projects/${encodeURIComponent(projId)}/`);
}

export function localMatterHref(id: string): string {
  const matterId = id.replace(/^boston-/, '');
  return href(`boston/matters/${matterId}/`);
}

export function localMatterFallbackHref(id: string): string {
  return href(`boston/matter/?id=${encodeURIComponent(id.replace(/^boston-/, ''))}`);
}

/** A Boston City Council committee's page, by its slug ("ways-and-means"). */
export function localCommitteeHref(slug: string): string {
  return href(`boston/committees/${slug}/`);
}

/** A councilor's page: boston-p324 → boston/councilors/324/, worcester-gary-rosen → worcester/councilors/gary-rosen/. */
export function localOfficialHref(id: string): string {
  if (id.startsWith('worcester-')) return href(`worcester/councilors/${id.slice('worcester-'.length)}/`);
  return href(`boston/councilors/${id.replace(/^boston-p/, '')}/`);
}

/** A Worcester council committee's page, by slug. */
export function worcesterCommitteeHref(slug: string): string {
  return href(`worcester/committees/${slug}/`);
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
