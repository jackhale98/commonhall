import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ON_DEMAND_API,
  OnDemandError,
  getOnDemand,
  validateRequest,
  type BillPayload,
  type MemberPayload,
} from '@civic/sync';
import { connect } from './db.ts';
import { FakeCongress, syntheticBill } from './fake-congress.ts';

const sql = connect();
afterAll(() => sql.end());

beforeEach(async () => {
  await sql`delete from public.archive_cache`;
  await sql`delete from public.api_usage`;
});

function api() {
  const fake = new FakeCongress();
  fake.addBill(
    syntheticBill(5, '2024-03-01T00:00:00Z', {
      congress: 118,
      cosponsors: [
        {
          bioguideId: 'B001328',
          firstName: 'Everton',
          lastName: 'Blair',
          party: 'D',
          state: 'GA',
          district: 13,
          fullName: 'Rep. Blair, Everton [D-GA-13]',
          sponsorshipDate: '2024-03-02',
          isOriginalCosponsor: true,
        },
      ],
      summaries: [{ actionDate: '2024-03-01', text: '<p>Does a thing.</p>', updateDate: '2024-03-05T00:00:00Z' }],
    }),
  );
  fake.members.set('A000375', {
    bioguideId: 'A000375',
    name: 'Arrington, Jodey',
    partyName: 'Republican',
    state: 'Texas',
    district: 19,
    chamber: 'House of Representatives',
    current: true,
    updateDate: '2026-01-01T00:00:00Z',
  });
  return fake;
}

describe('validateRequest', () => {
  it('accepts well-formed ids only', () => {
    expect(validateRequest('bill', '118-HR-5')).toEqual({ kind: 'bill', id: '118-hr-5' });
    expect(validateRequest('member', 'A000375')).toEqual({ kind: 'member', id: 'A000375' });
    expect(() => validateRequest('bill', '118-xx-5')).toThrow(OnDemandError);
    expect(() => validateRequest('bill', '999-hr-5')).toThrow(OnDemandError);
    expect(() => validateRequest('member', "A000375'; drop table bills")).toThrow(OnDemandError);
    expect(() => validateRequest('votes', '1')).toThrow(OnDemandError);
  });
});

describe('getOnDemand', () => {
  it('fetches an older-Congress bill, shapes it like our rows, then serves it from cache', async () => {
    const fake = api();
    const first = await getOnDemand(sql, (cap) => fake.client(cap), 'bill', '118-hr-5');
    expect(first.cached).toBe(false);
    const payload = first.payload as BillPayload;
    expect(payload.bill).toMatchObject({
      id: '118-hr-5',
      congress: 118,
      status: 'in_committee',
      summary_text: 'Does a thing.',
      cosponsors_count: 1,
    });
    expect(payload.sponsor).toMatchObject({ bioguide_id: 'A000375', chamber: 'house', state: 'TX', district: 19 });
    expect(payload.cosponsors[0]).toMatchObject({
      member_id: 'B001328',
      member: { name: 'Everton Blair', party: 'D' },
    });
    expect(payload.actions).toHaveLength(2);

    const requestsBefore = fake.requests.length;
    const second = await getOnDemand(sql, (cap) => fake.client(cap), 'bill', '118-hr-5');
    expect(second.cached).toBe(true);
    expect(fake.requests.length).toBe(requestsBefore);

    const [row] =
      await sql`select expires_at > now() + interval '29 days' as long_ttl from public.archive_cache where key = 'bill:118-hr-5'`;
    expect(row!.long_ttl).toBe(true);
    const [usage] = await sql`select requests from public.api_usage where api = ${ON_DEMAND_API}`;
    expect(usage!.requests).toBeGreaterThan(0);
  });

  it('fetches a member with recent sponsored legislation', async () => {
    const fake = api();
    const { payload } = await getOnDemand(sql, (cap) => fake.client(cap), 'member', 'A000375');
    const member = payload as MemberPayload;
    expect(member.member).toMatchObject({
      bioguide_id: 'A000375',
      name: 'Jodey Arrington',
      party: 'R',
      chamber: 'house',
      district: 19,
    });
    expect(member.sponsored[0]).toMatchObject({ id: '118-hr-5', status: 'in_committee' });
  });

  it('refuses uncached lookups once the hourly cap is reached', async () => {
    const fake = api();
    await sql`select public.record_api_usage(${ON_DEMAND_API}, 299)`;
    await expect(getOnDemand(sql, (cap) => fake.client(cap), 'bill', '118-hr-5')).rejects.toMatchObject({
      status: 429,
    });
    expect(fake.requests).toHaveLength(0);
  });
});
