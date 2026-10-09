/**
 * The background part of a Supreme Court syllabus: the summary the Reporter of
 * Decisions prints before each argued opinion ("The syllabus constitutes no part of
 * the opinion of the Court but has been prepared by the Reporter of Decisions for
 * the convenience of the reader"). It runs from the docket line ("No. 24–43.
 * Argued …—Decided …") to "Held:"; the holding is left out (the site states the
 * outcome from the Supreme Court Database). Works on text extracted from the
 * slip-opinion PDF, as CourtListener stores it, with or without layout spacing.
 * The text is kept word for word, only re-flowed: page headers, footnotes and
 * line-end hyphens are removed.
 */

const MAX = 3200;

/** Page furniture repeated on every page of a slip opinion or preliminary print. */
const FURNITURE = [
  /^\(Slip Opinion\)/i,
  /^OCTOBER TERM, \d{4}\b/,
  /^Syllabus$/,
  /^Cite as: /,
  /^Page Proof Pending Publication$/,
  /^\d{1,4}$/,
  // Running title: "WEST VIRGINIA v. B. P. J." (capitals, with "v.").
  /^(?:\d+\s+)?[A-Z0-9 .,'’&()-]+ v\. [A-Z0-9 .,'’&()-]+(?:\s+\d+)?$/,
  /^\d+\s+OCTOBER TERM, \d{4}$/,
];

/**
 * Ligatures that some PDFs lose ("suffcient", "affrmed"; preliminary prints do this).
 * Checked across the whole opinion: a damaged text also turns "filed" into "fled",
 * which no word list can catch, so any sign of damage rejects the whole syllabus.
 */
const LOST_LIGATURE = /\b(?:suffcient|affrm|fnd|benefts?|offcial|signifcant|specifc|fnal|frst)\w*/i;

/** Words that follow a compound's hyphen but never end a split word ("state-by-state"). */
const SMALL_WORDS = new Set(['and', 'or', 'by', 'to', 'the', 'in', 'of', 'for', 'a', 'an', 'on', 'at']);

export function syllabusBackground(text: string | null | undefined): string | null {
  if (!text) return null;
  const all = text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n');
  if (LOST_LIGATURE.test(all)) return null;
  const docket = /Decided\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\*?/.exec(all);
  if (!docket || !/Syllabus/.test(all.slice(0, docket.index))) return null;
  const startAt = docket.index + docket[0].length;
  const held = /\n\s*Held\s*:/.exec(all.slice(startAt));
  if (!held) return null;
  const body = all.slice(startAt, startAt + held.index);

  const lines: string[] = [];
  let inFootnote = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (/^[—–-]{4,}$/.test(line)) {
      inFootnote = true; // a footnote runs to the next page's running header
      continue;
    }
    if (inFootnote) {
      if (/^Syllabus$/.test(line)) inFootnote = false;
      continue;
    }
    if (!line || FURNITURE.some((re) => re.test(line))) continue;
    lines.push(line);
  }
  // A line-end hyphen is either typesetting ("nec-" / "essary") or a real compound
  // ("coordinated-" / "expenditure"): whichever form the rest of the opinion uses wins.
  const flat = all.replace(/\s+/g, ' ');
  let out = '';
  for (const line of lines) {
    const end = /([A-Za-z]+)-$/.exec(out);
    const next = /^([a-z]+)(-?)/.exec(line);
    if (end && next) {
      const joined = `${end[1]}${next[1]}`;
      const compound =
        next[2] === '-' || // "track-" / "and-field"
        SMALL_WORDS.has(next[1]!) ||
        new RegExp(`\\b${end[1]}-${next[1]}\\b`).test(flat);
      const plain = new RegExp(`\\b${joined}\\b`).test(flat);
      out = compound && !plain ? out + line : out.slice(0, -1) + line;
    } else if (/[–—]$/.test(out) && /^[\d(]/.test(line))
      out += line; // "§33–" / "6202(11)"
    else out += (out ? ' ' : '') + line;
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length < 40) return null;
  if (out.length > MAX) {
    const cut = out.lastIndexOf('. ', MAX);
    out = `${out.slice(0, cut > MAX / 2 ? cut + 1 : MAX).trim()} …`;
  }
  return out;
}
