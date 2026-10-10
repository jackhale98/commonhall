import { describe, expect, it } from 'vitest';
import { BOSTON, matterRow, meetingItemRows, type LegistarCity } from '../src/local/boston.ts';

const SPRINGFIELD: LegistarCity = {
  ...BOSTON,
  key: 'ma-springfield',
  name: 'Springfield',
  legistar: 'springfield',
  docketLabel: (file) => `File ${file}`,
};

describe('Legistar cities', () => {
  it('keys rows and links by the city settings', () => {
    const row = matterRow(
      { MatterId: 42, MatterFile: '0042', MatterTitle: 'An order', MatterTypeName: 'Council Order' } as never,
      undefined,
      SPRINGFIELD,
    );
    expect(row).toMatchObject({ id: 'ma-springfield-42', city: 'ma-springfield' });
    expect(row.legistar_url).toContain('springfield');
    const items = meetingItemRows(
      'ma-springfield-e1',
      [{ EventItemMatterId: 42, EventItemTitle: 'An order', EventItemMatterFile: '0042' }] as never,
      SPRINGFIELD,
    );
    expect(items[0]!.matter_id).toBe('ma-springfield-42');
  });

  it('defaults to Boston', () => {
    expect(matterRow({ MatterId: 7, MatterTitle: 'x' } as never).id).toBe('ma-boston-7');
  });
});
