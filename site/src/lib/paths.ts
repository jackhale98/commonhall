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
