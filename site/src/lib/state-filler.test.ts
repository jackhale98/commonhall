import { describe, expect, it } from 'vitest';
import { STATE_BILL_FILLER, STATE_BILL_FILLER_PG } from './state-filler';

const filler = [
  'A communication from the Office of the Comptroller (see item 1599-6152) submitting the transfer report',
  'Communication from the Treasurer relative to the state debt',
  'A report of the Berkshire District Attorney’s Office (under Section 24W(e) of Chapter 90)',
  'A monthly report of the Department of Unemployment Assistance relative to the trust fund',
  'Emergency Housing Assistance Program Bi-weekly September 17, 2026 Report',
  'Berkshire Regional Transit Authority FY26 Audited Financial Statements',
  'Petition of the town of Lenox for legislation',
];
const bills = [
  'An Act concerning school bus safety (Lens’ Law)',
  'An Act establishing a sick leave bank for Jonathan Murphy',
  'Resolve providing for an investigation relative to reporting requirements',
  'An Act relative to the reporting of lead levels in drinking water',
];

describe('STATE_BILL_FILLER', () => {
  it('matches reports and communications filed like bills', () => {
    for (const title of filler) expect(STATE_BILL_FILLER.test(title), title).toBe(true);
  });

  it('leaves bills alone', () => {
    for (const title of bills) expect(STATE_BILL_FILLER.test(title), title).toBe(false);
  });

  it('has a Postgres twin with the same alternatives', () => {
    // Postgres spells a word boundary \y; otherwise the two patterns are the same.
    const asJs = STATE_BILL_FILLER_PG.replace(/\\y/g, '\\b').replace(/^\((.*?\\b)\)/, '$1');
    expect(asJs).toBe(STATE_BILL_FILLER.source);
  });
});
