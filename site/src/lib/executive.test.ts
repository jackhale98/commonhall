import { describe, expect, it } from 'vitest';
import { splitNomination } from './executive';

describe('splitNomination', () => {
  it('takes the name and position from a nomination description', () => {
    expect(
      splitNomination(
        'Keith Heffern, of Virginia, a Career Member of the Senior Foreign Service, Class of Minister-Counselor, to be Ambassador Extraordinary and Plenipotentiary of the United States of America to the Gabonese Republic.',
      ),
    ).toEqual({
      name: 'Keith Heffern',
      position: 'Ambassador Extraordinary and Plenipotentiary of the United States of America to the Gabonese Republic',
    });
    expect(splitNomination('Sara Bailey, of Texas, to be Director of National Drug Control Policy.')).toEqual({
      name: 'Sara Bailey',
      position: 'Director of National Drug Control Policy',
    });
  });

  it('leaves descriptions without that shape alone', () => {
    expect(splitNomination('2 nominations for the Coast Guard')).toEqual({ name: null, position: null });
  });
});
