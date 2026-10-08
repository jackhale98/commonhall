import { describe, expect, it } from 'vitest';
import { normalize, prepare, search } from './search';

const index = prepare([
  { k: 'state', t: 'Massachusetts', s: 'MA · delegation, legislature and bills', h: '/states/ma/' },
  { k: 'member', t: 'Elizabeth Warren', s: 'D · Senator from Massachusetts', h: '/members/W000817/' },
  { k: 'member', t: 'Edward J. Markey', s: 'D · Senator from Massachusetts', h: '/members/M000133/' },
  { k: 'bill', t: 'One Big Beautiful Bill Act', s: 'H.R. 1', h: '/bills/119/hr/1/' },
  { k: 'discussion', t: 'What should Congress consider about H.R. 1?', s: 'Discussion', h: '/discussions/x/' },
  { k: 'councilor', t: 'Enrique Pepén', s: 'Boston City Council · District 5', h: '/boston/councilors/323/' },
]);

describe('palette search', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normalize('Pepén, H.R. 1')).toBe('pepen hr 1');
  });
  it('requires every word and ranks title-prefix matches first', () => {
    expect(search(index, 'mass').map((r) => r.t)[0]).toBe('Massachusetts');
    expect(search(index, 'warren').map((r) => r.t)).toEqual(['Elizabeth Warren']);
    expect(
      search(index, 'senator massachusetts')
        .map((r) => r.t)
        .sort(),
    ).toEqual(['Edward J. Markey', 'Elizabeth Warren']);
  });
  it('finds bills by number with or without spaces and dots', () => {
    expect(search(index, 'hr 1')[0]?.t).toBe('One Big Beautiful Bill Act');
    expect(search(index, 'HR1')[0]?.t).toBe('One Big Beautiful Bill Act');
    expect(search(index, 'h.r. 1')[0]?.t).toBe('One Big Beautiful Bill Act');
    expect(search(index, 'pepen')[0]?.t).toBe('Enrique Pepén');
  });
  it('returns nothing for an empty query', () => {
    expect(search(index, '  ')).toEqual([]);
  });
});
