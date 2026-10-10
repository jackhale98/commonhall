import { describe, expect, it } from 'vitest';
import { sortStatus, statusLabel, type StatusRow } from './status';

const row = (name: string, label: string, problem: string | null = null): StatusRow => ({
  kind: 'data',
  name,
  label,
  last_ok: null,
  newest: null,
  problem,
});

describe('statusLabel', () => {
  it('names cities, courts and states', () => {
    expect(statusLabel(row('matters:ma-boston', 'Council items: ma-boston'))).toBe('Boston: council items');
    expect(statusLabel(row('meetings:ma-worcester', 'x'))).toBe('Worcester: council meetings');
    expect(statusLabel(row('court:mass', 'x'))).toBe('Supreme Judicial Court decisions');
    expect(statusLabel(row('governor:MA', 'x'))).toBe('Massachusetts: governor’s orders');
    expect(statusLabel(row('311:ma-boston', 'x'))).toBe('Boston: 311 requests');
    expect(statusLabel(row('bills', 'Bills in Congress'))).toBe('Bills in Congress');
  });

  it('lists problems first', () => {
    const sorted = sortStatus([row('bills', 'Bills'), row('zba', 'Appeals', 'empty')]);
    expect(sorted.map((r) => r.name)).toEqual(['zba', 'bills']);
  });
});
