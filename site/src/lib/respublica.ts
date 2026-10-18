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
