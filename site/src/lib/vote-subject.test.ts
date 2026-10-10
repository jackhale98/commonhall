import { describe, expect, it } from 'vitest';
import { voteSubject } from './vote-subject';

describe('voteSubject', () => {
  it("prefers the bill's short title", () => {
    expect(
      voteSubject({
        bill_title: 'One Big Beautiful Bill Act',
        title: 'Motion to Invoke Cloture on the Motion to Proceed to H.R. 1',
      }),
    ).toBe('One Big Beautiful Bill Act');
  });

  it('names the nominee and the post, without their home state', () => {
    expect(
      voteSubject({
        question: 'On the Nomination PN1129',
        title: 'Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor',
      }),
    ).toBe('Keith Sonderling to be Secretary of Labor');
    expect(
      voteSubject({
        question: 'On the Cloture Motion PN1129',
        title: 'Motion to Invoke Cloture: Keith Sonderling to be Secretary of Labor',
      }),
    ).toBe('Keith Sonderling to be Secretary of Labor');
  });

  it('gives nothing when the title is only a bill number', () => {
    expect(voteSubject({ title: 'S. 4668, as amended' })).toBeNull();
    expect(voteSubject({ title: 'Motion to Invoke Cloture on the Motion to Proceed to H.R. 9340' })).toBeNull();
    expect(voteSubject({ title: 'Motion to Invoke Cloture: S. 4668, as Amended' })).toBeNull();
    expect(voteSubject({ title: 'H. Con. Res. 89' })).toBeNull();
    expect(voteSubject({ title: 'Motion to Proceed to S.J. Res. 197' })).toBeNull();
    expect(voteSubject({ title: 'Motion to Discharge S. Res. 852' })).toBeNull();
  });

  it("keeps an amendment's sponsor", () => {
    expect(voteSubject({ title: 'Booker Amdt. No. 6835', question: 'On the Amendment S.Amdt. 6835' })).toBe(
      'Booker Amdt. No. 6835',
    );
  });
});
