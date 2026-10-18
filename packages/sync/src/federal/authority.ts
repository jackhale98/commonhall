/**
 * The constitutional authority a House bill's sponsor cites. Each House bill and joint
 * resolution is introduced with a statement in the Congressional Record ("Congress has
 * the power to enact this legislation pursuant to the following: Article I, Section 8,
 * Clause 3"), which Congress.gov returns with the bill as
 * `constitutionalAuthorityStatementText`. Sponsors write the provision every way there
 * is ("Article 1, section 8", "Clause 18 of section 8 of Article I", "Art. 1 Sec. 8 Cl.
 * 1", "Section VIII of Article I", "Amendment XVI"), so the parser reads the numbered
 * parts in any order and returns the most specific reference each mention gives, as
 * Res Publica refs: `Constitution.1.8`, `Constitution.1.8.3`, `Amendment.14.5`. Clause
 * names alone ("the Commerce Clause") are not turned into numbers: only what the
 * sponsor numbered is read.
 */

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 };
const WORDS = [
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty',
  'zeroth first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth',
].map((list) => list.split(' '));

/** "VIII", "8", "Eight", "Fourteenth", "14th", "twenty-seventh" → a number, or null. */
export function numberOf(token: string): number | null {
  const t = token.toLowerCase().replace(/[.,:;]+$/, '');
  if (/^\d+(st|nd|rd|th)?$/.test(t)) return parseInt(t, 10);
  if (/^[ivxl]+$/.test(t)) {
    let n = 0;
    for (let i = 0; i < t.length; i++) {
      const v = ROMAN[t[i]!]!;
      n += v < (ROMAN[t[i + 1]!] ?? 0) ? -v : v;
    }
    return n;
  }
  const [tens, unit] = t.split('-');
  if (tens === 'twenty' && unit) {
    for (const list of WORDS) if (list.includes(unit)) return 20 + list.indexOf(unit);
  }
  if (tens === 'twentieth') return 20;
  for (const list of WORDS) if (list.includes(t)) return list.indexOf(t);
  return null;
}

type Kind = 'article' | 'section' | 'clause' | 'amendment';

interface Mention {
  kind: Kind;
  numbers: number[];
  start: number;
  end: number;
}

const NUM = String.raw`(?:\d+(?:st|nd|rd|th)?|[ivxl]+|(?:twenty-)?[a-z]+)`;
// After the first, a list goes on only with numbers: "Clauses 1, 14 and 18", but "Clause 3, Section 8" stops at 3.
const LIST = String.raw`${NUM}(?:\s*(?:,\s*and|,|and|&)\s*(?:\d+|[ivxl]+)\b)*`;
/** An ordinal before "Amendment": "Fourteenth", "14th", "Twenty-first" (not "and Amendment"). */
const ORDINAL = String.raw`(?:\d+(?:st|nd|rd|th)|(?:twenty-)?(?:${WORDS[1]!.slice(1).join('|')}))`;
// "Article I", "Art. 1", "Section 8", "Sec. 8", "Clause 3", "Cl. 3", "Clauses 3 and 18",
// "Amendment XIV" and, written the other way round, "Fourteenth Amendment", "14th Amendment".
const MENTION = new RegExp(
  String.raw`\b(?:(article|art\.?)\s+(${NUM})|(section|sec\.?)\s*(${NUM})|(clauses?|cl\.?)\s+(${LIST})|(amendment|amend\.?)\s+(${NUM})|(${ORDINAL})\s+amendment)\b`,
  'gi',
);

function mentions(text: string): Mention[] {
  const out: Mention[] = [];
  for (const m of text.matchAll(MENTION)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (m[1]) push('article', [m[2]!]);
    else if (m[3]) push('section', [m[4]!]);
    else if (m[5]) push('clause', m[6]!.split(/\s*(?:,\s*and|,|and|&)\s*/));
    else if (m[7]) push('amendment', [m[8]!]);
    else push('amendment', [m[9]!]);
    function push(kind: Kind, tokens: string[]) {
      // The numbers up to the first word that isn't one: "Clause 3 and the" is clause 3, and
      // "Section of Article 1", with no number, leaves the part out.
      const numbers: number[] = [];
      for (const t of tokens) {
        const n = numberOf(t);
        if (n === null || n <= 0) break;
        numbers.push(n);
      }
      if (numbers.length) out.push({ kind, numbers, start, end });
    }
  }
  return out;
}

/** Text between two parts of one reference: punctuation, "of", "of the", "the". */
const JOINER = /^[\s,.;:()]*(?:of(?:\s+the)?|the|to\s+the)?[\s,.;:()]*$/i;

/** Articles without sections, whose clauses are numbered under the article (Article VI, Clause 2). */
const UNSECTIONED = new Set([5, 6, 7]);

/** Each reference in a run of adjacent parts ("Clause 3 of Section 8 of Article I"). */
function refsOf(run: Mention[]): string[] {
  const part = (kind: Kind) => run.find((m) => m.kind === kind)?.numbers;
  const article = part('article')?.[0];
  const amendment = part('amendment')?.[0];
  const section = part('section')?.[0];
  const clauses = part('clause');
  if (article && article <= 7) {
    if (UNSECTIONED.has(article))
      return clauses ? clauses.map((c) => `Constitution.${article}.${c}`) : [`Constitution.${article}`];
    if (!section) return [`Constitution.${article}`];
    if (!clauses) return [`Constitution.${article}.${section}`];
    return clauses.map((c) => `Constitution.${article}.${section}.${c}`);
  }
  if (amendment && amendment <= 27) return [section ? `Amendment.${amendment}.${section}` : `Amendment.${amendment}`];
  return [];
}

/** The part of the statement that gives the authority, without the Record's page markers and markup. */
export function authorityText(statement: string | null | undefined): string {
  const text = (statement ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, ' ')
    .replace(/\[\[?Page [^\]]*\]\]?/gi, ' ')
    .replace(/\s+/g, ' ');
  const from = text.search(/pursuant\s+to\s+the\s+following:?/i);
  const body = from >= 0 ? text.slice(from).replace(/^pursuant\s+to\s+the\s+following:?/i, '') : text;
  const to = body.search(/the single subject of this legislation is/i);
  return (to >= 0 ? body.slice(0, to) : body).trim();
}

/** The Res Publica refs a constitutional authority statement cites, in order, without repeats. */
export function constitutionRefs(statement: string | null | undefined): string[] {
  const text = authorityText(statement);
  const found = mentions(text);
  const refs: string[] = [];
  let run: Mention[] = [];
  const flush = () => {
    for (const ref of refsOf(run)) if (!refs.includes(ref)) refs.push(ref);
    run = [];
  };
  for (const m of found) {
    const prev = run.at(-1);
    const joined = prev && JOINER.test(text.slice(prev.end, m.start)) && !run.some((r) => r.kind === m.kind);
    if (!joined) flush();
    run.push(m);
  }
  flush();
  return refs;
}
