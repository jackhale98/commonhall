import { describe, expect, it } from 'vitest';
import { caseTopic, splitSummary, summaryPreview } from './court';

describe('case summaries', () => {
  it('names SCDB topics, leaving out "miscellaneous"', () => {
    expect(caseTopic(1, 10050)).toEqual({ area: 'Criminal Procedure', issue: 'Search and seizure' });
    expect(caseTopic(13, null)).toEqual({});
    expect(caseTopic(null, null)).toEqual({});
  });

  it('cuts a preview at a word', () => {
    expect(summaryPreview('short')).toBe('short');
    const p = summaryPreview('word '.repeat(60), 50);
    expect(p.endsWith('word…')).toBe(true);
    expect(p.length).toBeLessThanOrEqual(51);
  });

  it('splits after a sentence, not inside "U. S."', () => {
    const text = `${'a'.repeat(440)} The U. S. District Court ruled. Then the Fourth Circuit reversed. ${'b '.repeat(150)}`;
    const [start, rest] = splitSummary(text);
    expect(start.endsWith('The U. S. District Court ruled.')).toBe(true);
    expect(rest.startsWith('Then the Fourth Circuit reversed.')).toBe(true);
    expect(splitSummary('One sentence only.')).toEqual(['One sentence only.', '']);
  });
});
