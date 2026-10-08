/**
 * Derive a bill's status from its actions. Pure and deterministic so the sync
 * jobs, the backfill and the site all agree.
 *
 * Congress.gov action `type` values: IntroReferral, Committee, Calendars, Floor,
 * ResolvingDifferences, President, BecameLaw, Veto, Discharge. The text is the
 * most reliable signal, so both are checked.
 */

export const BILL_STATUSES = [
  'introduced',
  'in_committee',
  'passed_house',
  'passed_senate',
  'passed_both',
  'agreed',
  'to_president',
  'vetoed',
  'law',
] as const;

export type BillStatus = (typeof BILL_STATUSES)[number];

export interface StatusAction {
  actionDate?: string | null;
  text?: string | null;
  type?: string | null;
  actionCode?: string | null;
}

export const STATUS_LABELS: Record<BillStatus, string> = {
  introduced: 'Introduced',
  in_committee: 'In committee',
  passed_house: 'Passed House',
  passed_senate: 'Passed Senate',
  passed_both: 'Passed Congress',
  agreed: 'Agreed to',
  to_president: 'To President',
  vetoed: 'Vetoed',
  law: 'Became law',
};

const PASSED_HOUSE = [
  /^passed\/agreed to in house/i,
  /^passed house\b/i,
  /^on passage passed\b/i,
  /^resolution agreed to in house/i,
];
const PASSED_SENATE = [/^passed\/agreed to in senate/i, /^passed senate\b/i, /^resolution agreed to in senate/i];
// Final agreement between chambers, e.g. "On motion that the House agree to the
// Senate amendment Agreed to by recorded vote: 218 - 214" or "Senate agreed to
// House amendment". Rejected motions do not match because they lack "agreed to".
const RESOLVING_BOTH = [
  /^(resolving differences -- )?(house|senate) agreed to (the )?(senate|house) amendment/i,
  /^(resolving differences -- )?(house|senate) concurred in (the )?(senate|house) amendment/i,
  /^on motion that the (house|senate) (agree|concur) (to|in) the (senate|house) amendments?\b.*\bagreed to\b/i,
  /^conference report agreed to in (house|senate)/i,
];
const REFERRED = [/^referred to\b/i, /\breferred to the (house )?(committee|subcommittee)/i];
const PRESENTED = [/^presented to president/i];
const SIGNED = [/^signed by president/i];
const LAW = [/^became (public|private) law/i, /^became law without signature/i];
const VETO = [/^vetoed by president/i, /^pocket vetoed by president/i];
const OVERRIDE = [/passed (house|senate) over veto/i, /over the president'?s veto/i];

const any = (patterns: RegExp[], text: string) => patterns.some((p) => p.test(text));

export function deriveStatus(billType: string, actions: StatusAction[]): BillStatus {
  const type = billType.toLowerCase();
  const simpleResolution = type === 'hres' || type === 'sres';

  let house = false;
  let senate = false;
  let referred = false;
  let presented = false;
  let vetoed = false;
  let law = false;

  // Order does not matter: each action only sets flags, and the precedence below
  // makes later facts win (a veto followed by an override ends in "law").
  for (const action of actions) {
    const text = (action.text ?? '').trim();
    const kind = (action.type ?? '').toLowerCase();
    if (!text) continue;

    if (kind === 'becamelaw' || any(LAW, text)) {
      law = true;
      continue;
    }
    if (kind === 'veto' || any(VETO, text)) {
      vetoed = true;
      continue;
    }
    if (any(OVERRIDE, text)) {
      // Override votes are followed by a "Became Public Law" action once both chambers succeed.
      continue;
    }
    if (any(PRESENTED, text) || any(SIGNED, text)) {
      presented = true;
      continue;
    }
    if (any(RESOLVING_BOTH, text)) {
      house = true;
      senate = true;
      continue;
    }
    if (any(PASSED_HOUSE, text)) house = true;
    if (any(PASSED_SENATE, text)) senate = true;
    if (any(REFERRED, text) || kind === 'committee') referred = true;
  }

  if (law) return 'law';
  if (vetoed) return 'vetoed';
  if (presented) return 'to_president';
  if (simpleResolution && (house || senate)) return 'agreed';
  if (house && senate) return 'passed_both';
  if (house) return 'passed_house';
  if (senate) return 'passed_senate';
  if (referred) return 'in_committee';
  return 'introduced';
}

/** Steps for the status tracker on bill pages. Simple resolutions stop at their own chamber. */
export function statusSteps(billType: string): { key: string; label: string }[] {
  const type = billType.toLowerCase();
  if (type === 'hres' || type === 'sres') {
    return [
      { key: 'introduced', label: 'Introduced' },
      { key: 'in_committee', label: 'Committee' },
      { key: 'agreed', label: type === 'hres' ? 'Agreed to in House' : 'Agreed to in Senate' },
    ];
  }
  const first = type.startsWith('h') ? 'House' : 'Senate';
  const second = first === 'House' ? 'Senate' : 'House';
  const steps = [
    { key: 'introduced', label: 'Introduced' },
    { key: 'in_committee', label: 'Committee' },
    { key: `passed_${first.toLowerCase()}`, label: `Passed ${first}` },
    { key: 'passed_both', label: `Passed ${second}` },
  ];
  if (type === 'hconres' || type === 'sconres') return steps;
  return [...steps, { key: 'to_president', label: 'To President' }, { key: 'law', label: 'Law' }];
}

/**
 * Index of the furthest completed step for `status` within `statusSteps(type)`,
 * or -1. A Senate-originated bill that has only passed the House (rare) still
 * shows the first-chamber step as incomplete.
 */
export function statusStepIndex(billType: string, status: BillStatus): number {
  const steps = statusSteps(billType).map((s) => s.key);
  const rank: Record<BillStatus, string> = {
    introduced: 'introduced',
    in_committee: 'in_committee',
    passed_house: 'passed_house',
    passed_senate: 'passed_senate',
    passed_both: 'passed_both',
    agreed: 'agreed',
    to_president: 'to_president',
    vetoed: 'to_president',
    law: 'law',
  };
  const idx = steps.indexOf(rank[status]);
  if (idx >= 0) return idx;
  // Passed only the second chamber: count as committee stage done.
  if (status === 'passed_house' || status === 'passed_senate') return steps.indexOf('in_committee');
  return 0;
}
