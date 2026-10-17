/**
 * Who wrote what in a Supreme Court decision, from its opinion text. CourtListener
 * keeps recent decisions as one combined document (the slip opinion with every
 * separate opinion in it), so its own concurrence and dissent counts are zero; the
 * text names them:
 *
 * - each separate opinion opens with a heading, in slip opinions and orders alike:
 *     JUSTICE THOMAS, with whom JUSTICE GORSUCH joins,
 *     dissenting.
 *   (title case in the preliminary prints: "Justice Gorsuch, concurring.");
 * - argued cases also have the Reporter's lineup at the end of the syllabus:
 *     ROBERTS, C. J., delivered the opinion of the Court, in which SOTOMAYOR, KAGAN,
 *     BARRETT, and JACKSON, JJ., joined. JACKSON, J., filed a concurring opinion, …
 */

export interface SeparateOpinion {
  /** "Thomas", or "The Chief Justice". */
  author: string;
  /** As the heading puts it: "dissenting", "concurring in the judgment and dissenting in part". */
  kind: string;
  /** Who joined it, as named in the heading (some join only in part; the lineup says which parts). */
  joined: string[];
}

/** "KAVANAUGH" → "Kavanaugh", "O’CONNOR" → "O’Connor"; names already in mixed case stay. */
function nameCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[’'-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

// A heading at the start of a line: who, optionally who joined, then the kind of opinion.
const HEADING =
  /(?:^|\n)[ \t]*(THE CHIEF JUSTICE|CHIEF JUSTICE [A-Z][A-Za-z’'-]+|JUSTICE [A-Z][A-Za-z’'-]+),((?:\s+with\s+whom\s+[^.]{1,200}?\s+joins?\b[^,.]{0,120},)?)\s+((?:concurring|dissenting)\b[^.]{0,80}?)\.[ \t]*(?:\n|$)/gi;

const JOINER = /THE CHIEF JUSTICE|JUSTICE ([A-Z][A-Za-z’'-]+)/gi;

const author = (raw: string) => {
  const s = squash(raw);
  if (/^THE CHIEF JUSTICE$/i.test(s)) return 'The Chief Justice';
  return nameCase(s.replace(/^(?:CHIEF )?JUSTICE\s+/i, ''));
};

/** The separate opinions in a decision's text, in the order they appear, once each. */
export function separateOpinions(text: string | null | undefined): SeparateOpinion[] {
  if (!text) return [];
  const out: SeparateOpinion[] = [];
  const seen = new Set<string>();
  for (const m of text.replace(/\r\n?/g, '\n').matchAll(HEADING)) {
    const who = author(m[1]!);
    const kind = squash(m[3]!).toLowerCase();
    const key = `${who}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const joined = [...(m[2] ?? '').matchAll(JOINER)].map((j) => (j[1] ? nameCase(j[1]) : 'The Chief Justice'));
    out.push({ author: who, kind, joined });
  }
  return out;
}

/** Concurring and dissenting opinions among them; one that dissents in part counts as a dissent. */
export function opinionCounts(list: SeparateOpinion[]): { concurrences: number; dissents: number } {
  const dissents = list.filter((o) => o.kind.includes('dissenting')).length;
  return { dissents, concurrences: list.length - dissents };
}

/**
 * The Reporter's lineup at the end of the syllabus, word for word but re-flowed:
 * names in their usual case (Roman numerals kept), report page references ("post, p. 464") dropped, and
 * "fled" (a lost ligature in some prints) read as "filed". Null when there is none.
 */
export function opinionLineup(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n');
  const m =
    /(?:^|\n)[ \t]*((?:[A-Z][A-Za-z’'-]+, (?:C\. )?J\.|PER CURIAM)[,.]?\s+(?:delivered|announced)\s+the\s+(?:opinion|judgment)[\s\S]*?)(?:\n[ \t]*\n|\nCite as:|\n[^\n]*argued the cause)/.exec(
      t,
    );
  if (!m) return null;
  const lineup = squash(m[1]!.replace(/-\n(?=[a-z])/g, ''))
    .replace(/\bfled\b/g, 'filed')
    .replace(/,\s*(?:post|ante),\s*p\.\s*\d+/g, '')
    .replace(/\b([A-Z][A-Z’'-]{2,})\b/g, (w) => (/^[IVXLC]+$/.test(w) ? w : nameCase(w)));
  return lineup.length >= 30 && lineup.length <= 1500 ? lineup : null;
}
