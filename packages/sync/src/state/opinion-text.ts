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
 * this layout (a rescript, damaged text).
 */

export interface OpinionSummary {
  keywords: string | null;
  opening: string | null;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Cut long text at a sentence end near `max` characters. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('." '));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
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
  let opening: string | null = null;
  // "GAZIANO, J.  The defendant …", "BUDD, C.J.  …" or "PER CURIAM.  …", to the paragraph's end.
  const author = /\n\s*(?:[A-Z][A-Z'’-]+(?:, C\.)?, J\.|PER CURIAM\.)\s+([\s\S]*?)(?:\n\s*\n|$)/.exec(text);
  if (author) {
    const para = squash(author[1]!).replace(/\s*\d+\s*$/, '');
    if (para.length >= 40) opening = clip(para, 700);
  }
  return { keywords, opening };
}
