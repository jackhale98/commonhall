/** Small, dependency-free text helpers for turning upstream data into rows. */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  sect: '§',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Convert a CRS summary (simple HTML) to plain text with blank lines between
 * paragraphs and "• " list items. The site renders it as text, never as HTML.
 */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '\n• ')
      .replace(/<\/\s*(p|div|h[1-6]|ul|ol|li|table|tr)\s*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n\n• /g, '\n• ')
    .trim();
  return text === '' ? null : text;
}

export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
  PR: 'Puerto Rico',
  GU: 'Guam',
  VI: 'Virgin Islands',
  AS: 'American Samoa',
  MP: 'Northern Mariana Islands',
};

const STATE_CODES: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
);

/** `California` or `CA` → `CA`. */
export function stateCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return STATE_CODES[v.toLowerCase()] ?? (v.toLowerCase() === 'u.s. virgin islands' ? 'VI' : null);
}

/** Party name or letter → single-letter code (D, R, I, L). */
export function partyCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'd' || v.startsWith('democrat')) return 'D';
  if (v === 'r' || v.startsWith('republican')) return 'R';
  if (v === 'l' || v.startsWith('libertarian')) return 'L';
  if (v === 'i' || v === 'id' || v.startsWith('independent')) return 'I';
  return v.charAt(0).toUpperCase() || null;
}

export function partyName(code: string | null | undefined): string | null {
  switch (code) {
    case 'D':
      return 'Democratic';
    case 'R':
      return 'Republican';
    case 'I':
      return 'Independent';
    case 'L':
      return 'Libertarian';
    default:
      return null;
  }
}

/** `Wahab, Aisha` → `Aisha Wahab`. Leaves names without a comma alone. */
export function directOrder(inverted: string | null | undefined): string | null {
  if (!inverted) return null;
  const idx = inverted.indexOf(',');
  if (idx < 0) return inverted.trim();
  const last = inverted.slice(0, idx).trim();
  const rest = inverted.slice(idx + 1).trim();
  return `${rest} ${last}`.trim();
}

/** `Rep. Foxx, Virginia [R-NC-5]` → `Virginia Foxx`. */
export function nameFromFullName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const stripped = fullName
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/^(Rep\.|Sen\.|Del\.|Resident Commissioner|Commish\.)\s+/i, '')
    .trim();
  return directOrder(stripped);
}

/** Normalise any date or date-time string to `YYYY-MM-DD`, or null. */
export function toDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1]! : null;
}

/** Normalise to an ISO timestamp; date-only strings become midnight UTC. */
export function toTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function chamberFromText(value: string | null | undefined): 'house' | 'senate' | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes('house')) return 'house';
  if (v.includes('senate')) return 'senate';
  return null;
}
