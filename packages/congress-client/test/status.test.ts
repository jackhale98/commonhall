import { describe, expect, it } from 'vitest';
import { deriveStatus, statusStepIndex, statusSteps, type StatusAction } from '../src/status.ts';
import { fixtureJson } from './helpers.ts';

const a = (text: string, type?: string): StatusAction => ({ text, type, actionDate: '2026-01-01' });

describe('deriveStatus', () => {
  it('recognises H.R. 1 (119th) as law from recorded actions', () => {
    const { actions } = fixtureJson<{ actions: StatusAction[] }>('congress/bill-hr1-actions.json');
    expect(deriveStatus('hr', actions)).toBe('law');
  });

  it('treats H.R. 1 minus its final actions as having passed both chambers', () => {
    const { actions } = fixtureJson<{ actions: StatusAction[] }>('congress/bill-hr1-actions.json');
    const beforePresident = actions.filter((x) => !/President|Public Law/.test(x.text ?? ''));
    expect(deriveStatus('hr', beforePresident)).toBe('passed_both');
  });

  it.each([
    [[], 'introduced'],
    [[a('Introduced in House', 'IntroReferral')], 'introduced'],
    [[a('Referred to the House Committee on Ways and Means.', 'IntroReferral')], 'in_committee'],
    [[a('Read twice and referred to the Committee on Finance.', 'IntroReferral')], 'in_committee'],
    [[a('Passed/agreed to in House: On passage Passed by the Yeas and Nays: 215 - 214.', 'Floor')], 'passed_house'],
    [
      [a('Failed of passage/not agreed to in House: On passage Failed by the Yeas and Nays: 200 - 230.', 'Floor')],
      'introduced',
    ],
    [
      [a('Passed/agreed to in Senate: Passed Senate without amendment by Unanimous Consent.', 'Floor')],
      'passed_senate',
    ],
    [
      [
        a('Passed/agreed to in Senate: Passed Senate without amendment by Unanimous Consent.', 'Floor'),
        a(
          'Passed/agreed to in House: On motion to suspend the rules and pass the bill Agreed to by voice vote.',
          'Floor',
        ),
      ],
      'passed_both',
    ],
    [[a('Presented to President.', 'President')], 'to_president'],
    [[a('Presented to President.'), a('Vetoed by President.', 'Veto')], 'vetoed'],
    [[a('Vetoed by President.', 'Veto'), a('Became Public Law No: 119-99.', 'BecameLaw')], 'law'],
    [[a('Pocket Vetoed by President.')], 'vetoed'],
  ] as [StatusAction[], string][])('%#: %j → %s', (actions, expected) => {
    expect(deriveStatus('hr', actions)).toBe(expected);
  });

  it('marks simple resolutions as agreed once their chamber agrees', () => {
    expect(
      deriveStatus('hres', [a('Passed/agreed to in House: On agreeing to the resolution Agreed to by voice vote.')]),
    ).toBe('agreed');
    expect(
      deriveStatus('sres', [
        a(
          'Submitted in the Senate, considered, and agreed to without amendment and with a preamble by Unanimous Consent.',
        ),
        a('Passed/agreed to in Senate: Submitted in the Senate, considered, and agreed to.'),
      ]),
    ).toBe('agreed');
  });

  it('ignores a rejected motion to concur', () => {
    expect(
      deriveStatus('hr', [
        a('Passed/agreed to in House: On passage Passed by recorded vote: 220 - 210.'),
        a('On motion that the House agree to the Senate amendment Failed by recorded vote: 200 - 230.'),
      ]),
    ).toBe('passed_house');
  });
});

describe('status steps', () => {
  it('orders steps by origin chamber', () => {
    expect(statusSteps('s').map((s) => s.label)).toEqual([
      'Introduced',
      'Committee',
      'Passed Senate',
      'Passed House',
      'To President',
      'Law',
    ]);
    expect(statusSteps('hres')).toHaveLength(3);
    expect(statusSteps('hconres')).toHaveLength(4);
  });

  it('maps statuses onto step indexes', () => {
    expect(statusStepIndex('hr', 'introduced')).toBe(0);
    expect(statusStepIndex('hr', 'passed_house')).toBe(2);
    expect(statusStepIndex('hr', 'passed_senate')).toBe(1);
    expect(statusStepIndex('hr', 'law')).toBe(5);
    expect(statusStepIndex('hr', 'vetoed')).toBe(4);
    expect(statusStepIndex('hres', 'agreed')).toBe(2);
  });
});
