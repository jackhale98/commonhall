/**
 * What each roll call was on, for vote lists: the bill's number and short title, or
 * the subject in the vote's official title (a nominee, a resolution). Lists showed
 * only the question ("On Passage"), which says nothing about what passed.
 */
import { billLabel, parseBillId } from '@civic/congress-client/ids';
import { voteSubject } from './vote-subject';

export interface VoteAbout {
  /** "H.R. 1", when the vote is on a bill. */
  bill?: string | null;
  /** "One Big Beautiful Bill Act", "Keith Sonderling to be Secretary of Labor". */
  subject?: string | null;
}

export function voteAbout(
  vote: { question: string | null; title?: string | null; bill_id?: string | null },
  billTitle?: string | null,
): VoteAbout {
  const ref = vote.bill_id ? parseBillId(vote.bill_id) : null;
  const bill = ref ? billLabel(ref.type, ref.number) : null;
  const subject = voteSubject({ bill_title: billTitle ?? undefined, title: vote.title, question: vote.question });
  return { bill, subject };
}

/** The compact row votes.json serves to the votes explorer. */
export interface VoteRow {
  /** Vote id. */
  i: string;
  /** Chamber. */
  c: 'house' | 'senate';
  r: number;
  d: string | null;
  q: string | null;
  res: string | null;
  y: number;
  n: number;
  b: string | null;
  s: string | null;
}

/** A vote (with what it was on) as a VoteRow. */
export function voteRow(
  v: {
    id: string;
    chamber: 'house' | 'senate';
    roll_number: number;
    date: string | null;
    question: string | null;
    result: string | null;
    yea_total: number;
    nay_total: number;
  } & VoteAbout,
): VoteRow {
  return {
    i: v.id,
    c: v.chamber,
    r: v.roll_number,
    d: v.date,
    q: v.question,
    res: v.result,
    y: v.yea_total,
    n: v.nay_total,
    b: v.bill ?? null,
    s: v.subject ?? null,
  };
}

export const passed = (result: string | null) =>
  /pass|agreed|confirmed|adopted/i.test(result ?? '') && !/not|fail|reject/i.test(result ?? '');
