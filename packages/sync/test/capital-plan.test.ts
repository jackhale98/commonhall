import { describe, expect, it } from 'vitest';
import { capitalProjectRow, dollars, planFromUrl } from '../src/local/capital-plan.ts';

describe('Capital Plan', () => {
  it('reads the plan years from the file name', () => {
    expect(planFromUrl('https://data.boston.gov/…/download/fy27-31-adopted-capital-plan-open-data-portal.csv')).toEqual(
      { plan: 'FY27-31', firstYear: 2027 },
    );
    expect(planFromUrl(undefined)).toEqual({ plan: 'Current', firstYear: null });
  });

  it('parses dollars from text columns', () => {
    expect(dollars('4125000')).toBe(4125000);
    expect(dollars('$1,200.50')).toBe(1200.5);
    expect(dollars('')).toBe(0);
    expect(dollars(null)).toBe(0);
  });

  it('sums the bond, other city and grant columns despite inconsistent names', () => {
    const row = capitalProjectRow(
      {
        'Proj ID': 'CCC25057',
        Department: 'Boston Centers for Youth and Families',
        Project_Name: 'BCYF Allston Community Center',
        Scope_Of_Work: 'Develop building program.',
        Project_Status: 'Study Underway',
        Neighborhood: 'Allston / Brighton',
        Total_Project_Budget: '10000000',
        GO_Expended: '102193',
        OC_Expended: '5',
        Grant_Expended: '0',
        Capital_Year_0: '100000',
        CapitalYear_1: '200000',
        OC_Year_1: '7',
        Capital_Year_25: '9597807',
        OCYear_25: '3',
        External_Funds: '0',
      },
      'FY27-31',
      2027,
    );
    expect(row).toMatchObject({
      proj_id: 'CCC25057',
      name: 'BCYF Allston Community Center',
      total_budget: 10_000_000,
      spent: 102_198,
      year0: 100_000,
      year1: 200_007,
      years_2_5: 9_597_810,
    });
    expect(capitalProjectRow({ 'Proj ID': '', Project_Name: 'x' }, 'FY27-31', 2027)).toBeNull();
  });
});
