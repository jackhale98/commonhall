/**
 * What a roll call was about, in a few words, for feed cards: the bill's short
 * title when the vote is on a bill we know, else the subject in the vote's official
 * title ("Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor" →
 * "Keith Sonderling to be Secretary of Labor"). Null when the title only repeats a
 * bill number or the question.
 */

/** "S. 4668, as amended", "H. Con. Res. 89", "Motion to Proceed to S.J. Res. 197": a citation and nothing more. */
const CITATION_ONLY =
  /^(?:(?:motion to (?:proceed|discharge|table|invoke cloture)(?: on the motion to proceed)?(?: to)?:?)\s*)?(?:H|S)\.?\s*(?:R|J|Con|Res|Amdt)?\.?\s*(?:Res\.?)?\s*\d+(?:,\s*as amended)?\.?$/i;

export function voteSubject(payload: Record<string, unknown>): string | null {
  const bill = typeof payload.bill_title === 'string' ? payload.bill_title.trim() : '';
  if (bill) return bill;
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!title) return null;
  // "Confirmation: …", "Motion to Invoke Cloture: …": the subject follows the colon.
  const colon = /^[^:]{3,60}:\s*(.+)$/.exec(title);
  let subject = (colon ? colon[1]! : title)
    // A nominee's home state: "Keith Sonderling, of F.L., to be" → "Keith Sonderling to be".
    .replace(/,\s+of\s+[^,]+,\s+to be\b/i, ' to be')
    .trim();
  if (CITATION_ONLY.test(subject) || CITATION_ONLY.test(title)) return null;
  const question = typeof payload.question === 'string' ? payload.question : '';
  if (question && question.toLowerCase().includes(subject.toLowerCase())) return null;
  if (subject.length > 140) subject = `${subject.slice(0, 139)}…`;
  return subject;
}
