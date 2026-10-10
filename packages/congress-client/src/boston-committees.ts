/**
 * Boston City Council committees. Legistar files committee hearings under the
 * City Council body and names the committee only in the meeting's location
 * ("Ways & Means Committee Hearing on Dockets #1829-1838"), spelled a little
 * differently from one hearing to the next. These helpers read the committee
 * from that text and settle each spelling on one name and slug.
 */

/** The council's standing committees (2026–2027 term), as the site names them. */
export const BOSTON_COMMITTEES = [
  'Arts, Culture, Entertainment, Tourism, and Special Events',
  'Census, Redistricting, and Elections',
  'City Services and Innovation Technology',
  'Civil Rights, Racial Equity, and Immigrant Advancement',
  'Committee of the Whole',
  'Community Preservation Act',
  'Education',
  'Environmental Justice, Resiliency, and Parks',
  'Government Operations',
  'Housing and Community Development',
  'Human Services',
  'Labor, Workforce, and Economic Development',
  'PILOT Agreements, Institutional and Intergovernmental Relations',
  'Planning, Development, and Transportation',
  'Post-Audit: Government Accountability, Transparency, and Accessibility',
  'Public Health, Homelessness, and Recovery',
  'Public Safety and Criminal Justice',
  'Rules, Ethics, and Administration',
  'Small Business and Professional Licensure',
  'Strong Women, Families, and Communities',
  'Veterans, Military Families, and Military Affairs',
  'Ways and Means',
];

/** Comparison key: lower-case words, without "and", "&" or punctuation. */
export function committeeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && w !== 'and')
    .join(' ');
}

/** Shortened or older names hearings still use, mapped to the committee's current name. */
const ALIASES: Record<string, string> = {
  'city services': 'City Services and Innovation Technology',
  'city service innovation technology': 'City Services and Innovation Technology',
  'labor economic development': 'Labor, Workforce, and Economic Development',
  'post audit': 'Post-Audit: Government Accountability, Transparency, and Accessibility',
};

const KNOWN = new Map(BOSTON_COMMITTEES.map((name) => [committeeKey(name), name]));

/** URL slug for a committee name ("Ways and Means" → "ways-and-means"). */
export function committeeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function canonical(raw: string): string {
  const key = committeeKey(raw);
  const known = KNOWN.get(key) ?? ALIASES[key];
  if (known) return known;
  // A committee we don't list yet: tidy the spelling ("&" → "and").
  return raw
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The committee(s) holding a meeting, from its location text; empty for a full
 * council meeting ("Council Chambers"). Joint hearings return each committee.
 */
export function committeesFromLocation(location: string | null | undefined): string[] {
  const text = (location ?? '').replace(/\s+/g, ' ').trim();
  if (/^committee of the whole\b/i.test(text)) return ['Committee of the Whole'];
  const m = /^(.+?)\s+(joint\s+)?(?:committee\s+(?:hearing|working session)|public testimony|working session)\b/i.exec(
    text,
  );
  if (!m) return [];
  const name = m[1]!.trim();
  if (!m[2]) return [canonical(name)];
  // Joint hearing: find every known committee named in the text.
  const key = ` ${committeeKey(name)} `;
  const found = new Set(
    [...KNOWN, ...Object.entries(ALIASES)].filter(([k]) => key.includes(` ${k} `)).map(([, n]) => n),
  );
  return found.size ? [...found] : [canonical(name)];
}
