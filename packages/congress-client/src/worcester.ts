/**
 * Worcester City Council from the city's website and PrimeGov.
 *
 *  - Councilors: worcesterma.gov/city-council/councilors, one card per councilor
 *    (<h2>name</h2>, <h3>seat</h3>, a mailto link and a headshot).
 *  - Committees: worcesterma.gov/city-council/standing-committees, one card per
 *    standing committee (chair, vice-chair, members) and a description in a dialog.
 *  - Meetings: PrimeGov, titled "City Council" or "Standing Committee on …",
 *    sometimes "(Meeting Jointly with Standing Committee on …)" or "- CANCELLED".
 *
 * The page parsers read the markup with patterns rather than a DOM, so each checks
 * its result and the caller refuses to replace good data with a short list.
 */
import { committeeKey, committeeSlug } from './boston-committees.ts';

export const WORCESTER_SITE = 'https://www.worcesterma.gov';
export const WORCESTER_COUNCILORS_URL = `${WORCESTER_SITE}/city-council/councilors`;
export const WORCESTER_COMMITTEES_URL = `${WORCESTER_SITE}/city-council/standing-committees`;

export interface WorcesterCouncilor {
  /** "worcester-khrystian-king". */
  id: string;
  name: string;
  /** "At-Large" or "District 2". */
  seat: string;
  district: number | null;
  /** "Mayor", "Vice Chair" or null. */
  title: string | null;
  email: string | null;
  photo_url: string | null;
}

export interface WorcesterCommittee {
  slug: string;
  name: string;
  description: string | null;
  members: { name: string; role: string | null }[];
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "Kathleen M. Toomey" → "Kathleen M. Toomey"; the site sometimes capitalises a whole name. */
function tidyName(raw: string): string {
  const name = decode(raw);
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** "worcester-khrystian-king": first and last name, middle initials dropped. */
export function worcesterOfficialId(name: string): string {
  const words = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z-]/g, ''))
    .filter((w) => w.length > 1);
  const parts = words.length > 2 ? [words[0], words.at(-1)] : words;
  return `worcester-${parts.join('-')}`;
}

/** Councilors on the council page, in page order. */
export function parseWorcesterCouncilors(html: string): WorcesterCouncilor[] {
  const out: WorcesterCouncilor[] = [];
  const card =
    /<h2>([^<]+)<\/h2>\s*<div class="row">[\s\S]*?<h3>([^<]+)<\/h3>[\s\S]*?mailto:([^"]+)"[\s\S]*?<img[^>]+src="([^"]+)"/g;
  for (const m of html.matchAll(card)) {
    const name = tidyName(m[1]!);
    const role = decode(m[2]!);
    const district = /District\s+(\d+)/i.exec(role)?.[1];
    const email = m[3]!.trim();
    out.push({
      id: worcesterOfficialId(name),
      name,
      seat: district ? `District ${district}` : 'At-Large',
      district: district ? Number(district) : null,
      title: /^mayor/i.test(role) ? 'Mayor' : /vice/i.test(role) ? 'Vice Chair' : null,
      // The mayor's card links the mayor's office address, which is the right contact; the council's shared one isn't.
      email: /^council@/i.test(email) ? null : email,
      photo_url: m[4]!.startsWith('http') ? m[4]! : `${WORCESTER_SITE}${m[4]}`,
    });
  }
  return [...new Map(out.map((c) => [c.id, c])).values()];
}

/** "Veterans' Memorials, Parks & Recreation" → "Veterans' Memorials, Parks and Recreation". */
export function worcesterCommitteeName(raw: string): string {
  return decode(raw)
    .replace(/^standing committee on\s+/i, '')
    .replace(/\s*&\s*/g, ' and ')
    .trim();
}

/** Standing committees with their members and descriptions. */
export function parseWorcesterCommittees(html: string): WorcesterCommittee[] {
  const descriptions = new Map<string, string>();
  for (const m of html.matchAll(
    /<div class="modal fade"[^>]*id="([^"]+)"[\s\S]*?<div class="modal-body">\s*<p>([\s\S]*?)<\/p>/g,
  )) {
    descriptions.set(m[1]!, decode(m[2]!));
  }
  const out: WorcesterCommittee[] = [];
  const card =
    /<div class="card-header">([^<]*)<\/div>\s*<div class="card-body">[\s\S]*?<h3 class="card-title">([\s\S]*?)<\/h3>\s*<p class="card-text">([\s\S]*?)<\/p>/g;
  for (const m of html.matchAll(card)) {
    const name = worcesterCommitteeName(m[1]!);
    const people = [m[2]!, ...m[3]!.split(/<br\s*\/?>/)]
      .map(decode)
      .filter((p) => p && !/^committee (members|description)$/i.test(p));
    const members = people.map((p) => {
      const [who, role] = p.split(/,\s*(?=(?:vice-?\s?)?chair)/i);
      return {
        name: tidyName(who!),
        role: role ? (/vice/i.test(role) ? 'Vice Chair' : 'Chair') : null,
      };
    });
    const target = /data-bs-target="#([^"]+)"/.exec(m[3]!)?.[1];
    out.push({
      slug: committeeSlug(name),
      name,
      description: (target && descriptions.get(target)) || null,
      members,
    });
  }
  return out;
}

export interface WorcesterMeetingKind {
  /** Committees holding it; empty for a full City Council meeting; null if not a council meeting. */
  committees: string[] | null;
  cancelled: boolean;
}

/** Whether a PrimeGov meeting is the City Council's, and which standing committees hold it. */
export function worcesterMeetingKind(title: string): WorcesterMeetingKind {
  const t = decode(title);
  const cancelled = /-\s*cancell?ed\s*$/i.test(t);
  const base = t.replace(/\s*-\s*cancell?ed\s*$/i, '').trim();
  if (/^city council$/i.test(base)) return { committees: [], cancelled };
  const own = /^standing committee on (.+?)(?:\s*\((?:meeting )?jointly with (.+)\))?$/i.exec(base);
  if (!own) return { committees: null, cancelled };
  const names = [own[1]!, ...(own[2] ? own[2].split(/\s+and\s+(?=standing committee)/i) : [])].map(
    worcesterCommitteeName,
  );
  return { committees: names, cancelled };
}

/** Match a committee name from a meeting title to the committee list (spellings differ: "&", apostrophes). */
export function matchCommittee<T extends { name: string }>(name: string, committees: T[]): T | undefined {
  const key = committeeKey(name.replace(/'/g, ''));
  return committees.find((c) => committeeKey(c.name.replace(/'/g, '')) === key);
}
