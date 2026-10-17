/**
 * What a Massachusetts appellate decision is about, from its opinion text (the
 * slip opinion as CourtListener holds it):
 *
 *   SJC-13512
 *        COMMONWEALTH  vs.  JANE DOE.
 *        Suffolk.     January 5, 2024. - May 2, 2024.
 *   Present:  Budd, C.J., Gaziano, Kafker, … & Wolohojian, JJ.
 *
 *   Homicide. Evidence, Prior misconduct, Hearsay. Constitutional
 *        Law, Confrontation of witnesses.                     ← keywords
 *
 *        Indictments found and returned in the Superior Court …
 *        …
 *        GAZIANO, J.  The defendant was convicted of …        ← opening
 *
 * The keywords are the reporter's subject headings; the opening is the first
 * paragraph of the court's opinion. Either is null when the text doesn't follow
 * this layout (a rescript, damaged text). Slip opinions are double-spaced (a blank
 * line after every line), so a blank line doesn't end a paragraph: an indented line
 * does. Connecticut's opinions open the same way ("MULLINS, C. J. The defendant …");
 * its syllabus is copyrighted and not used.
 *
 * Separate opinions are named from their headings: "KAFKER, J. (concurring, with
 * whom Wendlandt, J., joins)." and "BUDD, C.J. (dissenting)." (Massachusetts).
 */

export interface OpinionSummary {
  keywords: string | null;
  opening: string | null;
}

export interface StateSeparateOpinion {
  /** "Kafker", or "Chief Justice Budd". */
  author: string;
  /** "concurring", "dissenting", "concurring in part and dissenting in part". */
  kind: string;
  joined: string[];
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

// Words a period follows without ending a sentence: "State v. Daniel", "G. L. c. 278", "No. 5".
const ABBREVIATION =
  /(?:\b(?:v|vs|c|cl|ch|par|No|Nos|St|Stat|Gen|App|Supp|Mass|Conn|Inc|Co|Corp|Jr|Sr|al|seq|Dist|Dep't|Ct|Rev|Fed|Reg|U\.S)|\b[A-Z])\.$/;

/** Cut long text at a sentence end near `max` characters (not after an abbreviation). */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  let end = -1;
  for (const m of cut.matchAll(/[.?!]["”’)]?(?=\s+[A-Z“"(])/g)) {
    const at = m.index + m[0].length;
    if (!ABBREVIATION.test(cut.slice(Math.max(0, m.index - 12), m.index + 1))) end = at;
  }
  return end > max / 2 ? cut.slice(0, end) : `${cut.trimEnd()}…`;
}

export function opinionSummary(raw: string): OpinionSummary {
  const text = raw.replace(/\r/g, '').replace(/\f/g, '\n');
  let keywords: string | null = null;
  // The paragraph after the "Present:" list of justices (which ends "JJ." or "J.").
  const present = /Present:[\s\S]*?\b(?:JJ|J)\.\s*\n\s*\n([\s\S]*?)\n\s*\n/.exec(text);
  if (present) {
    const block = squash(present[1]!);
    // Subject headings: short capitalized phrases separated by periods and commas.
    const sentences = block.split(/\.\s+/).filter(Boolean);
    const headingLike = sentences.every((s) => s.split(/\s+/).length <= 12 && /^[A-Z]/.test(s));
    if (block.length <= 600 && headingLike) keywords = block.replace(/\.?$/, '.');
  }
  return { keywords, opening: openingParagraph(text) };
}

/** "WOLOHOJIAN" → "Wolohojian"; "O'CONNOR" → "O'Connor". */
const nameCase = (name: string) =>
  name.toLowerCase().replace(/(^|[’'-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());

// The opinion's author line: "GAZIANO, J.", "BUDD, C.J.", "MULLINS, C. J." or "PER CURIAM.", then its first
// words (on the same line, or below it in text extracted without the layout).
const AUTHOR_LINE = /\n[ \t]*(?:[A-Z][A-Z'’-]+, (?:C\.\s?)?J\.|PER CURIAM\.)\s+(?=[A-Z“"])/;

/** The first paragraph of the court's opinion, up to about 700 characters. */
function openingParagraph(text: string): string | null {
  const start = AUTHOR_LINE.exec(text);
  if (!start) return null;
  const rest = text.slice(start.index + start[0].length, start.index + start[0].length + 6000);
  const lines: string[] = [];
  for (const [i, line] of rest.split('\n').entries()) {
    if (!line.trim()) continue; // double spacing
    if (/^\s*\d{1,3}\s*$/.test(line)) continue; // page number
    // A new paragraph (or a footnote) starts indented; the first line is the opening's own.
    if (i > 0 && /^[ \t]{2,}\S/.test(line)) break;
    lines.push(line);
  }
  // Re-join words hyphenated across lines ("prin-" + "cipal"), then squash.
  const para = squash(lines.join('\n').replace(/([a-z])-\n([a-z])/g, '$1$2'))
    // Footnote markers stuck to words or punctuation ("trial,1 reserving", "(2).1 His").
    .replace(/([a-z.,;)”"])\d{1,2}(?=\s|$)/g, '$1');
  return para.length >= 60 ? clip(para, 700) : null;
}

// A separate opinion's heading in a Massachusetts opinion.
const MA_SEPARATE = /(?:^|\n)[ \t]*([A-Z][A-Z'’-]+), (C\.\s?J|J)\.\s+\(((?:concurring|dissenting)[^)]*)\)\./g;

/** The concurring and dissenting opinions named in a decision's text, once each. */
export function stateSeparateOpinions(raw: string | null | undefined): StateSeparateOpinion[] {
  if (!raw) return [];
  const out: StateSeparateOpinion[] = [];
  const seen = new Set<string>();
  for (const m of raw.replace(/\r/g, '').replace(/\f/g, '\n').matchAll(MA_SEPARATE)) {
    const author = `${/^C/.test(m[2]!) ? 'Chief Justice ' : ''}${nameCase(m[1]!)}`;
    const [kindPart, ...whom] = squash(m[3]!).split(/,\s*with whom\s+/i);
    const kind = kindPart!.replace(/,$/, '').toLowerCase();
    const joined = [...whom.join(' ').matchAll(/([A-Z][A-Za-z'’-]+), (C\.\s?J|J)\./g)].map(
      (j) => `${/^C/.test(j[2]!) ? 'Chief Justice ' : ''}${j[1]}`,
    );
    const key = `${author}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ author, kind, joined });
  }
  return out;
}
