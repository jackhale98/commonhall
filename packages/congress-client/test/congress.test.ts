import { describe, expect, it } from 'vitest';
import { CongressClient, toApiDateTime } from '../src/congress.ts';
import { RequestBudget } from '../src/http.ts';
import type { BillListItem } from '../src/types.ts';
import { fixtureJson, json, noSleep, replayFetch } from './helpers.ts';

const KEY = 'test-key';

describe('CongressClient.url', () => {
  const client = new CongressClient({ apiKey: KEY, fetch: async () => json({}) });

  it('adds format and key, keeps literal + in sort', () => {
    const url = new URL(client.url('/bill/119', { sort: 'updateDate+asc', limit: 250 }));
    expect(url.pathname).toBe('/v3/bill/119');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('api_key')).toBe(KEY);
    expect(url.search).toContain('sort=updateDate+asc');
    // `+` decodes to a space, which is what the API documents (`updateDate desc` in its own links).
    expect(url.searchParams.get('sort')).toBe('updateDate asc');
  });

  it('omits undefined params', () => {
    const url = new URL(client.url('/member/congress/119', { currentMember: undefined }));
    expect(url.searchParams.has('currentMember')).toBe(false);
  });
});

describe('toApiDateTime', () => {
  it('drops milliseconds', () => {
    expect(toApiDateTime('2026-10-08T03:04:05.678Z')).toBe('2026-10-08T03:04:05Z');
  });
});

describe('CongressClient with recorded fixtures', () => {
  it('reads the current Congress', async () => {
    const fetch = replayFetch([
      {
        match: (u) => u.pathname === '/v3/congress/current',
        respond: () => json(fixtureJson('congress/congress-current.json')),
      },
    ]);
    const client = new CongressClient({ apiKey: KEY, fetch });
    const congress = await client.currentCongress();
    expect(congress.number).toBe(119);
    expect(Math.max(...(congress.sessions ?? []).map((s) => s.number ?? 0))).toBe(2);
  });

  it('paginates by offset because the live `next` links are malformed', async () => {
    const page = fixtureJson<{ bills: BillListItem[]; pagination: { count: number; next: string } }>(
      'congress/bills-list.json',
    );
    // The recorded `next` duplicates the path inside the query string.
    expect(page.pagination.next).toContain('/v3/bill/119?/bill/119?');

    const total = 7;
    const all: BillListItem[] = Array.from({ length: total }, (_, i) => ({
      ...page.bills[i % page.bills.length]!,
      number: String(1000 + i),
    }));
    const fetch = replayFetch([
      {
        match: (u) => u.pathname === '/v3/bill/119',
        respond: (u) => {
          const offset = Number(u.searchParams.get('offset') ?? 0);
          const limit = Number(u.searchParams.get('limit'));
          const items = all.slice(offset, offset + limit);
          const more = offset + items.length < total;
          return json({ bills: items, pagination: { count: total, ...(more ? { next: page.pagination.next } : {}) } });
        },
      },
    ]);
    const client = new CongressClient({ apiKey: KEY, fetch });
    const seen: string[] = [];
    for await (const bill of client.listBills(119, {
      limit: 3,
      sort: 'updateDate+asc',
      fromDateTime: '2026-10-01T00:00:00.000Z',
    })) {
      seen.push(String(bill.number));
    }
    expect(seen).toEqual(all.map((b) => b.number));
    expect(fetch.calls.map((u) => u.searchParams.get('offset'))).toEqual([null, '3', '6']);
    expect(fetch.calls[0]!.searchParams.get('fromDateTime')).toBe('2026-10-01T00:00:00Z');
    expect(client.budget.used).toBe(3);
  });

  it('parses bill list items, including the new introducedDate field', async () => {
    const fetch = replayFetch([
      {
        match: (u) => u.pathname === '/v3/bill/119',
        respond: () => json({ ...fixtureJson<object>('congress/bills-list.json'), pagination: { count: 3 } }),
      },
    ]);
    const client = new CongressClient({ apiKey: KEY, fetch });
    const bills = await client.collect<'bills', BillListItem>('/bill/119', 'bills');
    expect(bills).toHaveLength(3);
    expect(bills[0]).toMatchObject({ congress: 119, type: 'HR', introducedDate: expect.any(String) });
    expect(bills[0]!.latestAction?.text).toMatch(/Referred/);
  });

  it('collects all bill actions', async () => {
    const fetch = replayFetch([
      {
        match: (u) => u.pathname === '/v3/bill/119/hr/1/actions',
        respond: () => json(fixtureJson('congress/bill-hr1-actions.json')),
      },
    ]);
    const client = new CongressClient({ apiKey: KEY, fetch });
    const actions = await client.getBillActions(119, 'HR', 1);
    expect(actions).toHaveLength(59);
    expect(actions[0]).toMatchObject({ actionCode: 'E40000', actionDate: '2025-07-04', type: 'President' });
    expect(actions.some((a) => a.recordedVotes?.[0]?.rollNumber === 190)).toBe(true);
    expect(fetch.calls[0]!.pathname).toBe('/v3/bill/119/hr/1/actions');
  });

  it('reads members with district and depiction', async () => {
    const fetch = replayFetch([
      {
        match: (u) => u.pathname === '/v3/member/congress/119',
        respond: () => {
          const body = fixtureJson<{ members: unknown[] }>('congress/members-list.json');
          return json({ members: body.members, pagination: { count: 3 } });
        },
      },
    ]);
    const client = new CongressClient({ apiKey: KEY, fetch });
    const members = [];
    for await (const m of client.listMembers(119, { currentMember: true })) members.push(m);
    expect(members).toHaveLength(3);
    expect(members[0]).toMatchObject({
      bioguideId: 'W000832',
      district: 14,
      partyName: 'Democratic',
      state: 'California',
    });
    expect(members[0]!.depiction?.imageUrl).toMatch(/^https:\/\/www\.congress\.gov\/img\/member\//);
    expect(fetch.calls[0]!.searchParams.get('currentMember')).toBe('true');
  });

  it('reads House vote member positions keyed by bioguideID', async () => {
    const fetch = replayFetch([
      {
        match: (u) => u.pathname === '/v3/house-vote/119/1/17/members',
        respond: () => json(fixtureJson('congress/house-vote-17-members.json')),
      },
    ]);
    const client = new CongressClient({ apiKey: KEY, fetch });
    const vote = await client.getHouseVoteMembers(119, 1, 17);
    expect(vote.voteQuestion).toBe('On Passage');
    expect(vote.results).toHaveLength(434);
    expect(vote.results![0]).toMatchObject({ bioguideID: 'A000055', voteCast: 'Yea' });
    expect(fetch.calls).toHaveLength(1);
  });

  it('stops paginating when the request budget runs out', async () => {
    const fetch = replayFetch([
      {
        match: () => true,
        respond: (u) => {
          const offset = Number(u.searchParams.get('offset') ?? 0);
          return json({
            bills: [{ congress: 119, number: String(offset), type: 'HR', title: 'A bill', updateDate: '2026-10-01' }],
            pagination: { count: 100, next: 'x' },
          });
        },
      },
    ]);
    const client = new CongressClient({ apiKey: KEY, fetch, budget: new RequestBudget(2), sleep: noSleep });
    const seen: string[] = [];
    await expect(async () => {
      for await (const b of client.listBills(119, { limit: 1 })) seen.push(String(b.number));
    }).rejects.toThrow(/budget/);
    expect(seen).toEqual(['0', '1']);
  });
});
