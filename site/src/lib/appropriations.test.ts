import { describe, expect, it } from 'vitest';
import {
  classify,
  fiscalYear,
  fundingYear,
  stageOf,
  stopgapEnd,
  trackedYears,
  type FundingBill,
} from './appropriations';

const bill = (id: string, short_title: string, extra: Partial<FundingBill> = {}): FundingBill => {
  const [, type, number] = /^\d+-([a-z]+)-(\d+)$/.exec(id)!;
  return {
    id,
    congress: 119,
    bill_type: type!,
    number: Number(number),
    title: `Making appropriations for ${short_title}`,
    short_title,
    status: 'in_committee',
    latest_action_date: '2026-06-01',
    latest_action_text: 'Referred to the Committee on Appropriations.',
    ...extra,
  };
};

describe('fiscal years', () => {
  it('start on October 1', () => {
    expect(fiscalYear('2026-09-30')).toBe(2026);
    expect(fiscalYear('2026-10-01')).toBe(2027);
  });

  it('track the next year’s bills from April', () => {
    expect(trackedYears('2026-10-18')).toEqual([2027]);
    expect(trackedYears('2026-05-01')).toEqual([2026, 2027]);
    expect(trackedYears('2026-02-01')).toEqual([2026]);
  });
});

describe('classify', () => {
  it('finds regular bills, packages and stopgaps for their year', () => {
    expect(classify(bill('119-hr-9495', 'Department of Defense Appropriations Act, 2027'))).toEqual({
      kind: 'regular',
      year: 2027,
    });
    expect(
      classify(
        bill(
          '119-hr-6938',
          'Commerce, Justice, Science; Energy and Water Development; and Interior and Environment Appropriations Act, 2026',
        ),
      ),
    ).toEqual({ kind: 'package', year: 2026 });
    expect(classify(bill('119-hr-7148', 'Consolidated Appropriations Act, 2026'))).toEqual({
      kind: 'package',
      year: 2026,
    });
    expect(classify(bill('119-hr-9770', 'Continuing Appropriations Act, 2027'))).toEqual({
      kind: 'continuing',
      year: 2027,
    });
    expect(
      classify({
        bill_type: 'hjres',
        short_title: null,
        title: 'Making continuing appropriations for fiscal year 2027, and for other purposes.',
      }),
    ).toEqual({ kind: 'continuing', year: 2027 });
  });

  it('leaves out other bills', () => {
    expect(classify(bill('119-hr-8800', 'National Defense Authorization Act for Fiscal Year 2027'))).toBeNull();
    expect(classify(bill('119-hr-4749', 'Texas Flood Emergency Supplemental Appropriations Act of 2025'))).toBeNull();
    expect(classify(bill('119-hr-5328', 'Indian Programs Advance Appropriations Act of 2025'))).toBeNull();
    expect(classify(bill('119-hr-10014', 'Restoring Accountability in Appropriations Act'))).toBeNull();
    expect(
      classify({
        bill_type: 'hres',
        short_title: null,
        title:
          'Providing for consideration of the bill (H.R. 8646) making appropriations for Agriculture for fiscal year 2027',
      }),
    ).toBeNull();
  });
});

describe('stageOf', () => {
  it('counts a bill on the floor calendar as reported', () => {
    expect(
      stageOf({ status: 'in_committee', latest_action_text: 'Placed on the Union Calendar, Calendar No. 621.' }),
    ).toBe('reported');
    expect(
      stageOf({ status: 'in_committee', latest_action_text: 'Referred to the Committee on Appropriations.' }),
    ).toBe('introduced');
    expect(stageOf({ status: 'passed_house', latest_action_text: 'Received in the Senate.' })).toBe('passed_house');
  });
});

describe('stopgapEnd', () => {
  it('reads the end date from the CRS summary', () => {
    expect(
      stopgapEnd(
        'This bill provides continuing FY2027 appropriations to federal agencies through the earlier of December 4, 2026, or the enactment of the applicable appropriations act.',
      ),
    ).toBe('2026-12-04');
    expect(stopgapEnd('No date here.')).toBeNull();
  });
});

describe('fundingYear', () => {
  const bills = [
    bill('119-hr-9495', 'Department of Defense Appropriations Act, 2027', {
      latest_action_text: 'Placed on the Union Calendar, Calendar No. 621.',
    }),
    bill('119-hr-8469', 'Military Construction, Veterans Affairs, and Related Agencies Appropriations Act, 2027', {
      status: 'passed_house',
    }),
    bill('119-s-4500', 'Military Construction, Veterans Affairs, and Related Agencies Appropriations Act, 2027'),
    bill('119-hr-9010', 'Legislative Branch Appropriations Act, 2027', { status: 'law', law_number: '119-130' }),
    bill('119-hr-9770', 'Continuing Appropriations Act, 2027', {
      status: 'law',
      summary_text:
        'provides continuing FY2027 appropriations to federal agencies through the earlier of December 4, 2026, or the enactment',
    }),
    bill('119-hr-8000', 'Defense Appropriations Act, 2026', { status: 'law' }),
  ];
  const year = fundingYear(bills, 2027);

  it('lays the year’s bills out by subcommittee, furthest bill per chamber', () => {
    const milcon = year.rows.find((r) => r.sub.key === 'milcon-va')!;
    expect(milcon.house?.id).toBe('119-hr-8469');
    expect(milcon.senate?.id).toBe('119-s-4500');
    expect(year.rows.find((r) => r.sub.key === 'defense')!.house?.stage).toBe('reported');
    expect(year.rows.find((r) => r.sub.key === 'agriculture')!.house).toBeNull();
    expect(year.rows).toHaveLength(12);
  });

  it('counts what passed and what became law, and finds the stopgap in force', () => {
    expect(year.enacted).toBe(1);
    expect(year.passedHouse).toBe(2);
    expect(year.passedSenate).toBe(1);
    expect(year.activeStopgap?.id).toBe('119-hr-9770');
    expect(year.activeStopgap?.end).toBe('2026-12-04');
  });

  it('marks subcommittees covered by a package that became law', () => {
    const withPackage = fundingYear(
      [
        ...bills,
        bill('119-hr-9900', 'Consolidated Appropriations Act, 2027', {
          status: 'law',
          summary_text: 'DIVISION A--DEPARTMENT OF DEFENSE APPROPRIATIONS ACT, 2027 ... DIVISION B--Homeland Security',
        }),
      ],
      2027,
    );
    expect(withPackage.rows.filter((r) => r.law).map((r) => r.sub.key)).toEqual(['defense', 'homeland', 'legislative']);
    expect(withPackage.packages[0]!.covers).toEqual(['defense', 'homeland']);
  });
});
