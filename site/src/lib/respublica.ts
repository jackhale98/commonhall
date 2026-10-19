/**
 * Res Publica (respublicalibrary.org), CommonHall's sister library of founding texts.
 * The two sites share refs: a clause is `Constitution.1.8.3`, an amendment's section
 * `Amendment.14.5`. Res Publica publishes every ref with its label and page at
 * /data/refs.json; the build reads it once and keeps the Constitution's and the
 * amendments' (about 200 of 2,700), never copying its texts.
 */
import { safeUrl } from '@civic/congress-client/safe-url';

export const RES_PUBLICA_URL = 'https://respublicalibrary.org/';
export const RES_PUBLICA_REFS = `${RES_PUBLICA_URL}data/refs.json`;
/** Fewer Constitution and amendment refs than this means the index changed shape. */
export const MIN_CONSTITUTION_REFS = 150;

/** A provision's label and its page on Res Publica, by ref. */
export type ClauseIndex = Record<string, { label: string; url: string }>;

/**
 * The Constitution's and amendments' refs from Res Publica's refs.json, each with an
 * absolute link checked to stay on respublicalibrary.org. Throws when the file doesn't
 * look like the index.
 */
export function constitutionIndex(raw: unknown): ClauseIndex {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Res Publica refs.json is not an object');
  const host = new URL(RES_PUBLICA_URL).host;
  const index: ClauseIndex = {};
  for (const [ref, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^(Constitution|Amendment)\.\d+(\.\d+){0,2}$/.test(ref)) continue;
    const { label, url } = (entry ?? {}) as { label?: unknown; url?: unknown };
    if (typeof label !== 'string' || typeof url !== 'string' || !label.trim()) continue;
    const link = safeUrl(url, RES_PUBLICA_URL);
    if (!link || new URL(link).host !== host) continue;
    index[ref] = { label: label.trim(), url: link };
  }
  const count = Object.keys(index).length;
  if (count < MIN_CONSTITUTION_REFS)
    throw new Error(
      `Res Publica refs.json has ${count} Constitution refs (expected at least ${MIN_CONSTITUTION_REFS})`,
    );
  return index;
}

export interface ClauseLink {
  ref: string;
  label: string;
  url: string;
}

/**
 * Links for the refs a bill cites: each to the nearest provision Res Publica has (a
 * clause it doesn't number falls back to its section, then its article), in order,
 * without repeats.
 */
export function clauseLinks(refs: readonly string[] | null | undefined, index: ClauseIndex | null): ClauseLink[] {
  if (!index || !refs?.length) return [];
  const out: ClauseLink[] = [];
  for (const ref of refs) {
    let at = ref;
    while (at.includes('.') && !index[at]) at = at.slice(0, at.lastIndexOf('.'));
    const hit = index[at];
    if (hit && !out.some((l) => l.ref === at)) out.push({ ref: at, ...hit });
  }
  return out;
}

/**
 * The Supreme Court Database's codes for the constitutional provision a case turned on
 * (its lawSupp variable, 100–241), each with SCDB's own description, word for word from
 * its online codebook, and the Res Publica ref of the text it names. SCDB numbers
 * paragraphs where the Constitution has clauses; they are the same divisions. Codes it
 * gives no article for (151–153) and statutes (300 and above) are left out.
 */
export const SCDB_PROVISIONS: Record<number, [ref: string, description: string]> = {
  100: ['Constitution.1.1', 'Article I, Section 1 (delegation of powers)'],
  101: [
    'Constitution.1.10.1',
    'Article I, Section 10 (state bill of attainder, ex post facto law, or bills of credit)',
  ],
  102: ['Constitution.1.2.1', 'Article I, Section 2, Paragraph 1 (composition of the House of Representatives)'],
  103: ['Constitution.1.2.3', 'Article I, Section 2, Paragraph 3 (apportionment of Representatives)'],
  104: ['Constitution.1.4.1', 'Article I, Section 4, Paragraph 1 (elections clause)'],
  105: ['Constitution.1.5.1', 'Article I, Section 5, Paragraph 1 (congressional qualifications)'],
  106: ['Constitution.1.6.1', 'Article I, Section 6, Paragraph 1 (speech or debate clause)'],
  107: ['Constitution.1.6.2', 'Article I, Section 6, Paragraph 2 (civil appointments)'],
  108: ['Constitution.1.7.1', 'Article I, Section 7, Paragraph 1 (origination clause)'],
  109: ['Constitution.1.7.2', 'Article I, Section 7, Paragraph 2 (separation of powers)'],
  110: [
    'Constitution.1.8.1',
    'Article I, Section 8, Paragraph 1 (taxing, spending, general welfare, or uniformity clause)',
  ],
  111: ['Constitution.1.8.3', 'Article I, Section 8, Paragraph 3 (interstate commerce clause)'],
  112: ['Constitution.1.8.4', 'Article I, Section 8, Paragraph 4 (bankruptcy clause)'],
  113: ['Constitution.1.8.7', 'Article I, Section 8, Paragraph 7 (postal power)'],
  114: ['Constitution.1.8.8', 'Article I, Section 8, Paragraph 8 (patent and copyright clause)'],
  115: ['Constitution.1.8.11', 'Article I, Section 8, Paragraph 11 (war power)'],
  116: ['Constitution.1.8.14', 'Article I, Section 8, Paragraph 14 (governance of the armed forces)'],
  117: ['Constitution.1.8.15', 'Article I, Section 8, Paragraph 15 (call-up of militia)'],
  118: ['Constitution.1.8.16', 'Article I, Section 8, Paragraph 16 (organizing the militia)'],
  119: [
    'Constitution.1.8.17',
    'Article I, Section 8, Paragraph 17 (governance of the District of Columbia and lands purchased from the states)',
  ],
  120: ['Constitution.1.8.18', 'Article I, Section 8, Paragraph 18 (necessary and proper clause)'],
  121: ['Constitution.1.9.2', 'Article I, Section 9, Paragraph 2 (suspension of the writ of habeas corpus)'],
  122: ['Constitution.1.9.3', 'Article I, Section 9, Paragraph 3 (bill of attainder or ex post facto law)'],
  123: ['Constitution.1.9.4', 'Article I, Section 9, Paragraph 4 (direct tax)'],
  124: ['Constitution.1.9.5', 'Article I, Section 9, Paragraph 5 (export clause)'],
  125: ['Constitution.1.9.6', 'Article I, Section 9, Paragraph 6 (preference to ports)'],
  126: ['Constitution.1.9.7', 'Article I, Section 9, Paragraph 7 (appropriations clause)'],
  127: ['Constitution.1.10.1', 'Article I, Section 10 (state bill of attainder or ex post facto law)'],
  128: ['Constitution.1.10.1', 'Article I, Section 10, Paragraph 1 (contract clause)'],
  129: ['Constitution.1.10.2', 'Article I, Section 10, Paragraph 2 (export-import clause)'],
  130: ['Constitution.1.10.3', 'Article I, Section 10, Paragraph 3 (compact clause)'],
  131: ['Constitution.2.1', 'Article II, Section 1 (executive power)'],
  132: ['Constitution.2.1.8', 'Article II, Section 1, Paragraph 8 (oath provision)'],
  133: ['Constitution.2.2.1', 'Article II, Section 2 (commander-in-chief)'],
  134: ['Constitution.2.2.1', 'Article II, Section 2, Paragraph 1 (presidential pardoning power)'],
  135: ['Constitution.2.2.2', 'Article II, Section 2, Paragraph 2 (appointments clause)'],
  136: ['Constitution.3.1', 'Article III, Section 1, Paragraph 1 (judicial power)'],
  137: [
    'Constitution.3.1',
    'Article III, Section 1, Paragraph 2 (good behavior and compensation clause of federal judges)',
  ],
  138: ['Constitution.3.2', 'Article III, Section 2 (extent of judicial power)'],
  139: ['Constitution.3.2.1', 'Article III, Section 2, Paragraph 1 (case or controversy requirement)'],
  140: ['Constitution.3.2.2', 'Article III, Section 2, Paragraph 2 (original jurisdiction)'],
  141: ['Constitution.3.2.3', 'Article III, Section 2, Paragraph 3 (vicinage requirement)'],
  142: ['Constitution.3.3', 'Article III, Section 3 (treason clause)'],
  143: ['Constitution.4.1', 'Article IV, Section 1 (full faith and credit clause)'],
  144: ['Constitution.4.2.1', 'Article IV, Section 2, Paragraph 1 (privileges and immunities clause)'],
  145: ['Constitution.4.2.2', 'Article IV, Section 2, Paragraph 2 (extradition clause)'],
  146: ['Constitution.4.3.2', 'Article IV, Section 3, Paragraph 2 (property clause)'],
  147: ['Constitution.4.4', 'Article IV, Section 4 (guarantee clause)'],
  148: ['Constitution.6.2', 'Article VI, Section 2 (supremacy clause)'],
  149: ['Constitution.6.3', 'Article VI, Section 3 (oath provision)'],
  150: ['Constitution.5', 'Amendment Clause'],
  200: ['Amendment.1', 'First Amendment (speech, press, and assembly)'],
  201: ['Amendment.1', 'First Amendment (association)'],
  202: ['Amendment.1', 'First Amendment (free exercise of religion)'],
  203: ['Amendment.1', 'First Amendment (establishment of religion)'],
  204: ['Amendment.1', 'First Amendment (petition clause)'],
  205: ['Amendment.4', 'Fourth Amendment'],
  206: ['Amendment.5', 'Fifth Amendment (double jeopardy)'],
  207: ['Amendment.5', 'Fifth Amendment (due process)'],
  208: ['Amendment.5', 'Fifth Amendment (grand jury)'],
  209: ['Amendment.5', 'Fifth Amendment (Miranda warnings)'],
  210: ['Amendment.5', 'Fifth Amendment (self-incrimination)'],
  211: ['Amendment.5', 'Fifth Amendment (takings clause)'],
  212: ['Amendment.5', 'Fifth Amendment (equal protection)'],
  213: ['Amendment.6', 'Sixth Amendment (right to confront and cross-examine, compulsory process)'],
  214: ['Amendment.6', 'Sixth Amendment (right to counsel)'],
  215: ['Amendment.6', 'Sixth Amendment (right to trial by jury)'],
  216: ['Amendment.6', 'Sixth Amendment (speedy trial)'],
  217: ['Amendment.6', 'Sixth Amendment (other provisions)'],
  218: ['Amendment.7', 'Seventh Amendment'],
  219: ['Amendment.8', 'Eighth Amendment (prohibition of excessive bail)'],
  220: ['Amendment.8', 'Eighth Amendment (prohibition of excessive fines)'],
  221: ['Amendment.8', 'Eighth Amendment (cruel and unusual punishment)'],
  222: ['Amendment.9', 'Ninth Amendment'],
  223: ['Amendment.10', 'Tenth Amendment'],
  224: ['Amendment.11', 'Eleventh Amendment'],
  225: ['Amendment.12', 'Twelfth Amendment'],
  226: ['Amendment.13', 'Thirteenth Amendment (both sections 1 and 2)'],
  227: ['Amendment.14.1', 'Fourteenth Amendment (privileges and immunities clause)'],
  228: ['Amendment.14.2', 'Fourteenth Amendment (reduction in representation clause)'],
  229: ['Amendment.14.1', 'Fourteenth Amendment (citizenship clause)'],
  230: ['Amendment.14.1', 'Fourteenth Amendment (due process)'],
  231: ['Amendment.14.1', 'Fourteenth Amendment (equal protection)'],
  232: ['Amendment.14.5', 'Fourteenth Amendment (enforcement clause)'],
  233: ['Amendment.15.1', 'Fifteenth Amendment (other provisions)'],
  234: ['Amendment.15.2', 'Fifteenth Amendment (enforcement clause)'],
  235: ['Amendment.16', 'Sixteenth Amendment'],
  236: ['Amendment.17', 'Seventeenth Amendment'],
  237: ['Amendment.21', 'Twenty-First Amendment'],
  238: ['Amendment.24', 'Twenty-Fourth Amendment'],
  239: ['Amendment.2', 'Second Amendment'],
  240: ['Amendment.14.1', 'Fourteenth Amendment (due process and equal protection)'],
  241: ['Amendment.14.1', 'Fourteenth Amendment (takings clause)'],
};

/** The provision a case turned on, by SCDB lawSupp code, linked to its text on Res Publica when it has it. */
export function caseProvision(
  lawSupp: number | null | undefined,
  index: ClauseIndex | null,
): { description: string; link: ClauseLink | null } | null {
  const entry = lawSupp == null ? undefined : SCDB_PROVISIONS[lawSupp];
  if (!entry) return null;
  const [ref, description] = entry;
  return { description, link: clauseLinks([ref], index)[0] ?? null };
}

/** Fewer landmark cases than this means the index changed shape. */
export const MIN_CASES = 100;

/** A landmark case's name and its page on Res Publica, by CourtListener cluster ID. */
export type CaseIndex = Record<number, { label: string; url: string }>;

/**
 * Res Publica's landmark cases from refs.json (`Case.<cluster id>`), each with an
 * absolute link checked to stay on respublicalibrary.org. Throws when the file doesn't
 * look like the index.
 */
export function caseIndex(raw: unknown): CaseIndex {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Res Publica refs.json is not an object');
  const host = new URL(RES_PUBLICA_URL).host;
  const index: CaseIndex = {};
  for (const [ref, entry] of Object.entries(raw as Record<string, unknown>)) {
    const id = /^Case\.(\d+)$/.exec(ref)?.[1];
    if (!id) continue;
    const { label, url } = (entry ?? {}) as { label?: unknown; url?: unknown };
    if (typeof label !== 'string' || typeof url !== 'string' || !label.trim()) continue;
    const link = safeUrl(url, RES_PUBLICA_URL);
    if (!link || new URL(link).host !== host) continue;
    index[Number(id)] = { label: label.trim(), url: link };
  }
  const count = Object.keys(index).length;
  if (count < MIN_CASES) throw new Error(`Res Publica refs.json has ${count} cases (expected at least ${MIN_CASES})`);
  return index;
}
