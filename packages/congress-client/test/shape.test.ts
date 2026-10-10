import { describe, expect, it } from 'vitest';
import { checkKept, checkShape, shapeProblems, ShapeError } from '../src/shape.ts';

const shape = { id: 'number', title: 'string', date: 'date', note: 'string?' };

describe('checkShape', () => {
  it('accepts records with empty (null) fields and leaves out optional ones', () => {
    const rows = [
      { id: 1, title: 'A', date: '2026-10-01T00:00:00', note: 'x' },
      { id: 2, title: null, date: null },
    ];
    expect(checkShape('test', rows, shape)).toBe(rows);
    expect(checkShape('test', [], shape)).toEqual([]);
  });

  it('fails when a required field is gone from every record (a rename)', () => {
    const rows = [{ id: 1, Title: 'A', date: '2026-10-01' }];
    expect(() => checkShape('Legistar matters', rows, shape)).toThrow(ShapeError);
    expect(shapeProblems(rows, shape)).toEqual(['no "title" in any of 1 records']);
  });

  it('fails when a field changes type, tolerating the odd record', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: i, title: 't', date: '2026-01-01' }));
    expect(shapeProblems([...many, { id: 'x', title: 't', date: '2026-01-01' }], shape)).toEqual([]);
    expect(shapeProblems([{ id: '1', title: 't', date: 'Oct 1' }], shape)).toEqual([
      '"id" is string in 1 of 1, expected number',
      '"date" is string in 1 of 1, expected date',
    ]);
    expect(shapeProblems([{ id: 1, title: 't', date: '2026-01-01', note: 5 }], shape)).toEqual([
      '"note" is number in 1 of 1, expected string',
    ]);
  });

  it('accepts either of two types', () => {
    expect(shapeProblems([{ n: '12' }, { n: 12 }], { n: 'string|number' })).toEqual([]);
  });
});

describe('checkKept', () => {
  it('fails when most of a sizeable batch was skipped', () => {
    expect(() => checkKept('t', 40, 30)).not.toThrow();
    expect(() => checkKept('t', 5, 0)).not.toThrow();
    expect(() => checkKept('t', 40, 3)).toThrow(/only 3 of 40/);
  });
});
