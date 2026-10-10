import { describe, expect, it } from 'vitest';
import { activeNav, localTrail, NAV, orderedItems, PHONE_NAV } from './nav';

const at = (path: string) => {
  const { group, item } = activeNav(path);
  return [group?.key, item?.key];
};

describe('localTrail', () => {
  const labels = (path: string) => localTrail(path).map((i) => i.label);

  it('names the state you are in, not Massachusetts', () => {
    expect(labels('states/de/')).toEqual(['All states', 'Delaware']);
    expect(labels('states/de/committees/')).toEqual(['All states', 'Delaware']);
    expect(localTrail('states/de/')[1]?.path).toBe('states/de/');
  });

  it('leads back up through Massachusetts, never down to its cities', () => {
    expect(labels('states/ma/')).toEqual(['All states', 'Massachusetts']);
    expect(labels('states/ma/boston/council/')).toEqual(['All states', 'Massachusetts', 'Boston']);
    expect(labels('states/ma/worcester/budget/')).toEqual(['All states', 'Massachusetts', 'Worcester']);
  });

  it('is empty where there is no state to show', () => {
    expect(labels('states/')).toEqual([]);
    expect(labels('state-legislator/')).toEqual([]);
    expect(labels('bills/')).toEqual([]);
  });
});

describe('activeNav', () => {
  it('puts Congress pages under Congress', () => {
    expect(at('bills/119/hr/1/')).toEqual(['congress', 'bills']);
    expect(at('bill/')).toEqual(['congress', 'bills']);
    expect(at('members/')).toEqual(['congress', 'members']);
    expect(at('members/W000817/')).toEqual(['congress', 'members']);
    expect(at('vote/')).toEqual(['congress', 'votes']);
    expect(at('committees/hsag/')).toEqual(['congress', 'committees']);
  });

  it('tells Massachusetts and Boston from other states', () => {
    expect(at('states/')).toEqual(['local', 'states']);
    expect(at('states/tx/')).toEqual(['local', 'states']);
    expect(at('states/ma/')).toEqual(['local', 'ma']);
    expect(at('states/ct/governor/26-3/')).toEqual(['local', 'ct']);
    expect(at('states/ma/bills/2025/h-1/')).toEqual(['local', 'ma']);
    expect(at('states/ma/boston/budget/')).toEqual(['local', 'ma-boston']);
    expect(at('states/ma/worcester/')).toEqual(['local', 'ma-worcester']);
    expect(at('state-bill/')).toEqual(['local', 'states']);
  });

  it('handles single-link sections and the home page', () => {
    expect(at('executive/orders/2025-01234/')).toEqual(['executive', undefined]);
    expect(at('court/cases/123/')).toEqual(['court', undefined]);
    expect(at('discussion/')).toEqual(['discuss', undefined]);
    expect(at('following/')).toEqual(['feed', undefined]);
    expect(at('')).toEqual([undefined, undefined]);
    expect(at('privacy/')).toEqual([undefined, undefined]);
  });

  it('does not match a prefix inside a longer word', () => {
    expect(at('billsx/')).toEqual([undefined, undefined]);
  });
});

describe('orderedItems', () => {
  it('reads the local trail from all states down to the cities', () => {
    const local = NAV.find((g) => g.key === 'local')!;
    // Each featured state, then its cities in registry order.
    const labels = orderedItems(local).map((i) => i.label);
    expect(labels).toEqual([
      'All states',
      'Massachusetts',
      'Boston',
      'Worcester',
      'Somerville',
      'Connecticut',
      'Bristol',
      'Middletown',
    ]);
  });
});

describe('a city outside Massachusetts', () => {
  it('trails back through its own state', () => {
    expect(localTrail('states/ct/bristol/council/').map((i) => i.label)).toEqual([
      'All states',
      'Connecticut',
      'Bristol',
    ]);
    expect(localTrail('states/ct/middletown/').map((i) => i.path)).toEqual([
      'states/',
      'states/ct/',
      'states/ct/middletown/',
    ]);
    expect(at('states/ct/middletown/neighborhoods/')).toEqual(['local', 'ct-middletown']);
  });
});

describe('PHONE_NAV', () => {
  it('lists every page in the header menus exactly once', () => {
    const header = NAV.flatMap((g) => (g.items ? g.items.map((i) => i.path) : [g.path!]));
    const phone = PHONE_NAV.flatMap((s) => s.items.map((i) => i.path));
    expect([...phone].sort()).toEqual([...header].sort());
  });
});
