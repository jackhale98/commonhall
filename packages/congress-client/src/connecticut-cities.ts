/**
 * Council rosters from two Connecticut cities' websites (both CivicPlus sites):
 *
 *  - Bristol: bristolct.gov/1030/City-Council-Members, one editor block per member:
 *    a photo, then "Greg Hahn (D)<br>District 1", a phone and a mailto link; the
 *    mayor's block reads "Ellen Zoppo-Sassu, Mayor". Two councilors per district,
 *    three districts. Blocks sometimes keep empty mailto links to former members, so
 *    the email is the one whose link text is an address.
 *  - Middletown: middletownct.gov/458/Common-Council, a staff-directory widget of
 *    h-cards: "Jeanette Blackwell (D)", a job title ("President", "Council Member"),
 *    an email and a photo. Twelve members, all elected citywide; the Council Clerk and
 *    a card for the council as a whole are on the same widget and are left out.
 *
 * The parsers read markup with patterns, so callers refuse a short result.
 */

export const BRISTOL_SITE = 'https://www.bristolct.gov';
export const BRISTOL_COUNCIL_URL = `${BRISTOL_SITE}/1030/City-Council-Members`;
export const MIDDLETOWN_SITE = 'https://www.middletownct.gov';
export const MIDDLETOWN_COUNCIL_URL = `${MIDDLETOWN_SITE}/458/Common-Council`;

export interface CityCouncilor {
  /** "ct-bristol-greg-hahn". */
  id: string;
  name: string;
  /** "District 1" or "At-Large" (the mayor, elected citywide). */
  seat: string;
  district: number | null;
  /** "Mayor", "President", "Majority Leader" or null. */
  title: string | null;
  /** "D", "R", "U"… as the page gives it. */
  party: string | null;
  email: string | null;
  photo_url: string | null;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const SUFFIX = /^(jr|sr|ii|iii|iv)$/;

/** "ct-bristol-greg-hahn": the city key, then first and last name (middle initials and suffixes dropped). */
export function councilorId(city: string, name: string): string {
  const words = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s,]+/)
    .map((w) => w.replace(/[^a-z-]/g, ''))
    .filter((w) => w.length > 1 && !SUFFIX.test(w));
  const parts = words.length > 2 ? [words[0], words.at(-1)] : words;
  return `${city}-${parts.join('-')}`;
}

/** "Greg Hahn (D)" → { name: "Greg Hahn", party: "D" }. */
function nameAndParty(raw: string): { name: string; party: string | null } {
  const text = decode(raw);
  const m = /^(.*?)\s*\(([A-Z]{1,3})\)\s*$/.exec(text);
  return m ? { name: m[1]!.trim(), party: m[2]! } : { name: text, party: null };
}

const absolute = (site: string, src: string | undefined) =>
  !src ? null : src.startsWith('http') ? src : `${site}${src.startsWith('/') ? '' : '/'}${src}`;

/** Bristol's mayor and councilors, in page order. */
export function parseBristolCouncil(html: string): CityCouncilor[] {
  const out: CityCouncilor[] = [];
  for (const block of html.split(/<div class="fr-view">/).slice(1)) {
    const body = block.split(/<\/div>/)[0]!;
    const photo = /<img[^>]+src="([^"]+)"/.exec(body)?.[1];
    const lines = body
      .replace(/<img[^>]*>/g, '')
      .split(/<br[^>]*>|<\/p>/)
      .map(decode)
      .filter(Boolean);
    const email =
      [...body.matchAll(/<a[^>]+href="mailto:([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
        .filter((m) => /@/.test(decode(m[2]!)))
        .map((m) => m[1]!.trim())[0] ?? null;
    const mayor = lines.map((l) => /^(.+?),\s*Mayor\b/i.exec(l)).find(Boolean);
    if (mayor) {
      const name = decode(mayor[1]!);
      out.push({
        id: councilorId('ct-bristol', name),
        name,
        seat: 'At-Large',
        district: null,
        title: 'Mayor',
        party: null,
        email,
        photo_url: absolute(BRISTOL_SITE, photo),
      });
      continue;
    }
    const at = lines.findIndex((l) => /^District\s+\d+$/i.test(l));
    if (at < 1) continue;
    const { name, party } = nameAndParty(lines[at - 1]!);
    const district = Number(/\d+/.exec(lines[at]!)![0]);
    out.push({
      id: councilorId('ct-bristol', name),
      name,
      seat: `District ${district}`,
      district,
      title: null,
      party,
      email,
      photo_url: absolute(BRISTOL_SITE, photo),
    });
  }
  return [...new Map(out.map((c) => [c.id, c])).values()];
}

/** Middletown's Common Council members (the clerk left out), in page order. */
export function parseMiddletownCouncil(html: string): CityCouncilor[] {
  const out: CityCouncilor[] = [];
  for (const card of html.split(/<li class="widgetItem h-card">/).slice(1)) {
    const body = card.split(/<\/li>/)[0]!;
    const rawName = /<h4[^>]*p-name[^>]*>([\s\S]*?)<\/h4>/.exec(body)?.[1];
    if (!rawName) continue;
    const job = decode(/p-job-title">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? '');
    if (/clerk/i.test(job)) continue;
    const { name, party } = nameAndParty(rawName);
    // The widget also has a card for the council as a whole ("Common Council", council@…).
    if (!name || /\bcouncil\b/i.test(name)) continue;
    out.push({
      id: councilorId('ct-middletown', name),
      name,
      seat: 'At-Large',
      district: null,
      title: job && !/^(council ?member|councilm[ae]n|councilwoman)$/i.test(job) ? job : null,
      party,
      email: /href="mailto:([^"]+)"/.exec(body)?.[1]?.trim() ?? null,
      photo_url: absolute(MIDDLETOWN_SITE, /<img[^>]+src="([^"]+)"/.exec(body)?.[1]),
    });
  }
  return [...new Map(out.map((c) => [c.id, c])).values()];
}
