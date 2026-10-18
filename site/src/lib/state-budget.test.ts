import { describe, expect, it } from 'vitest';
import {
  budgetGroups,
  budgetLineRow,
  budgetYear,
  officialTitle,
  townName,
  yearElapsed,
  type StateBudgetTotal,
} from './state-budget';

const total = (t: Partial<StateBudgetTotal>): StateBudgetTotal => ({
  fiscal_year: 2027,
  cabinet: 'EXECUTIVE OFFICE OF HEALTH & HUMAN SERVICES',
  category: 'Medicaid',
  accounts: 1,
  enacted: 0,
  supplemental: 0,
  total_enacted: 0,
  available: 0,
  spent: 0,
  ...t,
});

describe('budgetGroups', () => {
  const totals = [
    total({ total_enacted: 100, spent: 30, accounts: 2 }),
    total({ category: 'Medicaid', cabinet: 'TREASURER & RECEIVER GENERAL', total_enacted: 50, spent: 10 }),
    total({ category: 'Debt Service', cabinet: 'TREASURER & RECEIVER GENERAL', total_enacted: 200 }),
    total({ category: '', total_enacted: 5 }),
    total({ fiscal_year: 2026, total_enacted: 120 }),
    total({ fiscal_year: 2025, total_enacted: 999 }),
  ];

  it('adds up a year by category, largest first, with the year before', () => {
    expect(budgetGroups(totals, 2027, 'category')).toEqual([
      { label: 'Debt Service', value: 200, spent: 0, prev: 0, accounts: 1 },
      { label: 'Medicaid', value: 150, spent: 40, prev: 120, accounts: 3 },
      { label: 'Not classified', value: 5, spent: 0, prev: 0, accounts: 1 },
    ]);
  });

  it('names secretariats in title case', () => {
    expect(budgetGroups(totals, 2027, 'cabinet').map((g) => g.label)).toEqual([
      'Treasurer & Receiver General',
      'Executive Office of Health & Human Services',
    ]);
  });
});

describe('budgetYear', () => {
  it('sums every account in the year', () => {
    expect(
      budgetYear([total({ total_enacted: 10, spent: 4 }), total({ total_enacted: 5, spent: 1 })], 2027),
    ).toMatchObject({ total_enacted: 15, spent: 5, accounts: 2 });
  });
});

describe('yearElapsed', () => {
  it('runs July 1 to June 30', () => {
    expect(yearElapsed(2027, new Date('2026-07-01T00:00:00Z'))).toBe(0);
    expect(yearElapsed(2027, new Date('2026-10-16T00:00:00Z'))).toBeCloseTo(107 / 365, 3);
    expect(yearElapsed(2027, new Date('2027-08-01T00:00:00Z'))).toBe(1);
    expect(yearElapsed(2027, new Date('2026-01-01T00:00:00Z'))).toBe(0);
  });

  it('takes another start month (the federal year starts in October)', () => {
    expect(yearElapsed(2027, new Date('2026-10-01T00:00:00Z'), 10)).toBe(0);
  });
});

describe('budgetLineRow', () => {
  it('keeps the numbers and tidies capital-letter names', () => {
    expect(
      budgetLineRow({
        account: '70610008',
        account_name: 'REIMBURSEMENT OF SCHOOL AID TO CITIES,',
        department: 'DEPARTMENT OF REVENUE',
        cabinet: 'EXECUTIVE OFFICE OF EDUCATION',
        category: 'Direct Local Aid',
        enacted: 1,
        supplemental: 0,
        total_enacted: 1,
        available: 1,
        spent: 0.5,
      }),
    ).toEqual({
      a: '70610008',
      n: 'Reimbursement of School Aid to Cities,',
      d: 'Department of Revenue',
      c: 'Executive Office of Education',
      k: 'Direct Local Aid',
      e: 1,
      s: 0,
      v: 1,
      x: 0.5,
    });
  });
});

describe('officialTitle', () => {
  it('title-cases capital-letter names and keeps initials', () => {
    expect(officialTitle('MBTA STATE AND LOCAL CONTRIBUTION')).toBe('MBTA State and Local Contribution');
    expect(officialTitle('DCF FAMILY RESOURCE CENTERS')).toBe('DCF Family Resource Centers');
    expect(officialTitle('EXECUTIVE OFFICE OF HEALTH and HUMAN SERVICES')).toBe(
      'Executive Office of Health and Human Services',
    );
    expect(officialTitle('SNAP  HEALTH INCENTIVES PILOT')).toBe('SNAP Health Incentives Pilot');
    expect(officialTitle('OF COUNSEL FEES')).toBe('Of Counsel Fees');
    expect(officialTitle('LOCAL AID TAX RELIEF')).toBe('Local Aid Tax Relief');
    expect(officialTitle('Managed Care Plan')).toBe('Managed Care Plan');
  });
});

describe('Connecticut lines and towns', () => {
  it('carry the fund only where the state has funds', () => {
    const line = {
      account: 'General Fund|Department of Social Services|Medicaid',
      account_name: 'Medicaid',
      department: 'Department of Social Services',
      cabinet: 'Department of Social Services',
      category: 'Human Services',
      enacted: 10,
      supplemental: 0,
      total_enacted: 10,
      available: 10,
      spent: 4,
    };
    expect(budgetLineRow({ ...line, fund: 'General Fund' })).toMatchObject({ n: 'Medicaid', f: 'General Fund' });
    expect(budgetLineRow({ ...line, fund: '' })).not.toHaveProperty('f');
  });

  it('name towns in title case', () => {
    expect(townName('GROTON (CITY)')).toBe('Groton (City)');
    expect(townName('NEW LONDON')).toBe('New London');
    expect(townName('BRISTOL')).toBe('Bristol');
  });
});
