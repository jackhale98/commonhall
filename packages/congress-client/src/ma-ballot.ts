/**
 * Massachusetts ballot questions from the Secretary of the Commonwealth's
 * "Information for Voters" guide (sec.state.ma.us): one page per statewide question,
 * `{year}-ballot-question{n}.htm`. Each page has the question's number, kind and
 * title in its heading, then sections under fixed headings: the Attorney General's
 * summary, what a yes and a no vote do, the fiscal consequences, the 150-word
 * arguments for and against (written by each side), the Legislature's committee
 * reports (proposed laws only) and the full text.
 *
 * The site turns away plain requests, so a browser reads the pages
 * (scripts/load-ma-ballot.ts); this module only parses their HTML.
 */

export const maBallotIndex = (year: number) =>
  `https://www.sec.state.ma.us/divisions/elections/research-and-statistics/${year}-information-for-voters/${year}-ballot-questions.htm`;

export const maBallotQuestionUrl = (year: number, n: number) =>
  `https://www.sec.state.ma.us/divisions/elections/research-and-statistics/${year}-information-for-voters/${year}-ballot-question${n}.htm`;

export interface BallotArgument {
  /** The argument's paragraphs; a note from the Secretary (no organized side) comes first. */
  text: string[];
  /** "Authored by" lines: names, organizations and websites (street addresses and phone numbers left out). */
  authors: string[];
}

export interface BallotReport {
  title: string;
  text: string[];
}

export interface MaBallotQuestion {
  number: number;
  /** "Law Proposed by Initiative Petition", "Referendum on an Existing Law", … */
  kind: string;
  title: string;
  /** The question as asked ("Do you approve of a law summarized below, …?"). */
  question: string | null;
  summary: string[];
  yesVote: string;
  noVote: string;
  fiscal: string[];
  argumentFor: BallotArgument | null;
  argumentAgainst: BallotArgument | null;
  reports: BallotReport[];
  fullText: string[];
  /** Each section's opening line on who wrote it ("As required by law, summaries are written by …"), by section. */
  notes: Record<string, string>;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  sect: '§',
  middot: '·',
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** An element's text: tags dropped, <br> kept as a line break, spaces (and the source's line breaks) squeezed. */
export function htmlText(html: string): string {
  return decode(
    html
      .replace(/\s+/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \u00a0]+/g, ' ')
      .replace(/ *\n */g, '\n'),
  ).trim();
}

interface Block {
  tag: 'h2' | 'h3' | 'p';
  text: string;
}

/**
 * The article's headings and paragraphs, in order. The guide's HTML is hand-written:
 * most paragraphs are <p>, but some are bare text separated by blank lines, so both
 * block tags and blank lines end a paragraph.
 */
function blocks(article: string): Block[] {
  const out: Block[] = [];
  for (const part of article.split(/(<h[23]\b[^>]*>[\s\S]*?<\/h[23]>)/i)) {
    const heading = /^<(h[23])\b[^>]*>([\s\S]*?)<\/h[23]>$/i.exec(part);
    if (heading) {
      const text = htmlText(heading[2]!);
      if (text) out.push({ tag: heading[1]!.toLowerCase() as 'h2' | 'h3', text });
      continue;
    }
    const paragraphs = part
      .replace(/<li\b[^>]*>/gi, '\n\n• ')
      .replace(/<\/?(p|li|ul|ol|div|blockquote|table|tr)\b[^>]*>/gi, '\n\n')
      .split(/\n[ \t\r]*\n/);
    for (const raw of paragraphs) {
      const text = htmlText(raw);
      if (text) out.push({ tag: 'p', text });
    }
  }
  return out;
}

const SECTION_NOTE = /^(As (required|provided) by law|The following reports were written)/i;
const AUTHORED = /^Authored by:?/i;
// Street addresses and phone numbers in the authors' lines.
const CONTACT =
  /^\d+[\w.-]*\s+\S|\b[A-Z]{2}\s+\d{5}(-\d{4})?$|^\(?\d{3}\)?[\s.-]?\d{3}-\d{4}$|^P\.?\s?O\.? Box|^c\/o\b/i;

const authorLines = (text: string) =>
  text
    .replace(AUTHORED, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !CONTACT.test(l));

function argument(list: Block[]): BallotArgument | null {
  const text: string[] = [];
  const authors: string[] = [];
  for (const b of list) {
    if (AUTHORED.test(b.text)) authors.push(...authorLines(b.text));
    else text.push(b.text);
  }
  // Now and then the authors' block has no "Authored by:" label: a last paragraph of
  // short lines with an address or phone number.
  const last = text.at(-1);
  if (!authors.length && last && last.includes('\n') && last.split('\n').some((l) => CONTACT.test(l.trim()))) {
    text.pop();
    authors.push(...authorLines(last));
  }
  return text.length ? { text, authors } : null;
}

const sectionKey = (heading: string): string | null => {
  const h = heading.toLowerCase();
  if (h.startsWith('summary')) return 'summary';
  if (h.includes('what will your vote do')) return 'vote';
  if (h.includes('fiscal')) return 'fiscal';
  if (h.startsWith('arguments')) return 'arguments';
  if (h.includes('legislative report')) return 'reports';
  if (h.includes('full text')) return 'fullText';
  return null;
};

/** Parse one question page. Throws when the page doesn't have the guide's layout. */
export function parseMaBallotQuestion(html: string): MaBallotQuestion {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const head = h1 ? htmlText(h1[1]!) : '';
  const m = /^Question\s+(\d+):?\s*([^\n]*)\n+([\s\S]+)$/i.exec(head);
  if (!m) throw new Error(`Ballot question page: no "Question N" heading (found ${JSON.stringify(head.slice(0, 80))})`);
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1];
  if (!article) throw new Error(`Ballot question ${m[1]}: no article`);

  const sections = new Map<string, Block[]>();
  let current = 'intro';
  for (const b of blocks(article)) {
    if (b.tag === 'h2') {
      current = sectionKey(b.text) ?? current;
      continue;
    }
    if (!sections.has(current)) sections.set(current, []);
    sections.get(current)!.push(b);
  }

  const notes: Record<string, string> = {};
  const body = (key: string) => {
    const list = (sections.get(key) ?? []).filter((b) => {
      if (b.tag === 'p' && SECTION_NOTE.test(b.text) && !notes[key]) {
        notes[key] = b.text;
        return false;
      }
      return true;
    });
    return list;
  };

  const vote = body('vote');
  const yes = vote.find((b) => /^A YES VOTE\b/i.test(b.text))?.text;
  const no = vote.find((b) => /^A NO VOTE\b/i.test(b.text))?.text;

  // Arguments: h3 "In Favor:" and "Against:", each with its paragraphs and authors.
  const args = body('arguments');
  const split = (re: RegExp) => {
    const start = args.findIndex((b) => b.tag === 'h3' && re.test(b.text));
    if (start < 0) return [];
    const end = args.findIndex((b, i) => i > start && b.tag === 'h3');
    return args.slice(start + 1, end < 0 ? undefined : end);
  };

  const reports: BallotReport[] = [];
  for (const b of body('reports')) {
    if (b.tag === 'h3') reports.push({ title: b.text.replace(/^Question\s+\d+:\s*/i, ''), text: [] });
    else if (reports.length) reports.at(-1)!.text.push(b.text);
  }

  const question: MaBallotQuestion = {
    number: Number(m[1]),
    kind: m[2]!.trim(),
    title: m[3]!.replace(/\s+/g, ' ').trim(),
    question: (sections.get('intro') ?? []).find((b) => b.tag === 'p' && /\?$/.test(b.text))?.text ?? null,
    summary: body('summary').map((b) => b.text),
    yesVote: yes ?? '',
    noVote: no ?? '',
    fiscal: body('fiscal').map((b) => b.text),
    argumentFor: argument(split(/^In Favor/i)),
    argumentAgainst: argument(split(/^Against/i)),
    reports,
    fullText: body('fullText').map((b) => b.text),
    notes,
  };
  // A changed layout shows up as missing core sections: fail rather than store a blank question.
  const missing = (
    [
      ['summary', question.summary.length],
      ['yes vote', question.yesVote],
      ['no vote', question.noVote],
      ['full text', question.fullText.length],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`Ballot question ${question.number}: missing ${missing.join(', ')}`);
  return question;
}

/** The statewide question pages linked from the guide (Question 1 ▹ … chain or a list), by number. */
export function maBallotQuestionCount(indexHtml: string): number | null {
  const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const m = /information on (?:each of )?the (\w+) statewide questions?/i.exec(htmlText(indexHtml));
  if (!m) return null;
  const n = Number(m[1]) || words.indexOf(m[1]!.toLowerCase()) + 1;
  return n > 0 ? n : null;
}

/** Election Day for a November state election: the Tuesday after the first Monday. */
export function electionDay(year: number): string {
  const d = new Date(Date.UTC(year, 10, 1));
  const firstMonday = 1 + ((8 - d.getUTCDay()) % 7);
  return new Date(Date.UTC(year, 10, firstMonday + 1)).toISOString().slice(0, 10);
}
