/**
 * An in-memory stand-in for the Congress.gov API, built on recorded responses.
 * Tests mutate `upstream` (add actions, cosponsors, new bills) and the fake
 * serves list/detail/sub-endpoint responses consistent with it, including the
 * live API's quirks (malformed `next` links, date-only list `updateDate`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CongressClient, RequestBudget, type FetchLike } from '@civic/congress-client';

export function fixtureJson<T = any>(path: string): T {
  const url = new URL(`../../packages/congress-client/test/fixtures/${path}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as T;
}

export interface UpstreamBill {
  congress: number;
  type: string; // upper case, as the API reports it
  number: number;
  title: string;
  introducedDate: string;
  updateDate: string; // full timestamp
  originChamber: 'House' | 'Senate';
  sponsor?: {
    bioguideId: string;
    firstName: string;
    lastName: string;
    party: string;
    state: string;
    district?: number;
  };
  policyArea?: string;
  actions: any[]; // newest first, as the API returns them
  cosponsors: any[];
  subjects: string[];
  summaries: any[];
  textVersions: any[];
  titles: any[];
  laws?: any[];
}

export interface UpstreamMember {
  bioguideId: string;
  name: string; // "Last, First"
  partyName: string;
  state: string; // full name
  district?: number;
  chamber: 'House of Representatives' | 'Senate';
  current: boolean;
  imageUrl?: string;
  updateDate: string;
}

export class FakeCongress {
  bills = new Map<string, UpstreamBill>();
  members = new Map<string, UpstreamMember>();
  houseVotes: any[] = [];
  houseVoteMembers = new Map<string, any>();
  requests: URL[] = [];

  static key(congress: number, type: string, number: number | string) {
    return `${congress}-${type.toLowerCase()}-${number}`;
  }

  addBill(bill: UpstreamBill) {
    this.bills.set(FakeCongress.key(bill.congress, bill.type, bill.number), bill);
    return bill;
  }

  client(budgetLimit = Number.POSITIVE_INFINITY): CongressClient {
    return new CongressClient({
      apiKey: 'test',
      fetch: this.fetch,
      budget: new RequestBudget(budgetLimit, 'congress'),
      sleep: async () => undefined,
    });
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  private page<T>(key: string, items: T[], url: URL, path: string) {
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const slice = items.slice(offset, offset + limit);
    const more = offset + slice.length < items.length;
    return this.json({
      [key]: slice,
      pagination: {
        count: items.length,
        // Reproduce the live API's malformed next link.
        ...(more
          ? { next: `https://api.congress.gov/v3${path}?${path}?offset=${offset + limit}&limit=${limit}&format=json` }
          : {}),
      },
      request: { contentType: 'application/json', format: 'json' },
    });
  }

  private listItem(b: UpstreamBill) {
    return {
      congress: b.congress,
      introducedDate: b.introducedDate,
      latestAction: b.actions[0] ? { actionDate: b.actions[0].actionDate, text: b.actions[0].text } : undefined,
      number: String(b.number),
      originChamber: b.originChamber,
      originChamberCode: b.originChamber[0],
      title: b.title,
      type: b.type,
      // Live list items carry a date-only updateDate.
      updateDate: b.updateDate.slice(0, 10),
      updateDateIncludingText: b.updateDate.slice(0, 10),
      url: `https://api.congress.gov/v3/bill/${b.congress}/${b.type.toLowerCase()}/${b.number}?format=json`,
    };
  }

  private detail(b: UpstreamBill) {
    const withdrawn = b.cosponsors.filter((c) => c.sponsorshipWithdrawnDate).length;
    return {
      bill: {
        actions: { count: b.actions.length, url: '' },
        congress: b.congress,
        ...(b.cosponsors.length > 0
          ? {
              cosponsors: {
                count: b.cosponsors.length - withdrawn,
                countIncludingWithdrawnCosponsors: b.cosponsors.length,
                url: '',
              },
            }
          : {}),
        introducedDate: b.introducedDate,
        latestAction: b.actions[0] ? { actionDate: b.actions[0].actionDate, text: b.actions[0].text } : undefined,
        laws: b.laws,
        legislationUrl: `https://www.congress.gov/bill/${b.congress}th-congress/house-bill/${b.number}`,
        number: String(b.number),
        originChamber: b.originChamber,
        policyArea: b.policyArea ? { name: b.policyArea } : undefined,
        sponsors: b.sponsor
          ? [
              {
                ...b.sponsor,
                fullName: `Rep. ${b.sponsor.lastName}, ${b.sponsor.firstName} [${b.sponsor.party}-${b.sponsor.state}]`,
              },
            ]
          : [],
        ...(b.subjects.length + (b.policyArea ? 1 : 0) > 0
          ? { subjects: { count: b.subjects.length + (b.policyArea ? 1 : 0), url: '' } }
          : {}),
        ...(b.summaries.length > 0 ? { summaries: { count: b.summaries.length, url: '' } } : {}),
        ...(b.textVersions.length > 0 ? { textVersions: { count: b.textVersions.length, url: '' } } : {}),
        ...(b.titles.length > 0 ? { titles: { count: b.titles.length, url: '' } } : {}),
        title: b.title,
        type: b.type,
        updateDate: b.updateDate,
        updateDateIncludingText: b.updateDate,
      },
    };
  }

  fetch: FetchLike = async (input) => {
    const url = new URL(input);
    this.requests.push(url);
    const path = url.pathname.replace(/^\/v3/, '');
    let m: RegExpExecArray | null;

    if ((m = /^\/bill\/(\d+)$/.exec(path))) {
      const congress = Number(m[1]);
      const from = url.searchParams.get('fromDateTime');
      const to = url.searchParams.get('toDateTime');
      const items = [...this.bills.values()]
        .filter((b) => b.congress === congress)
        .filter((b) => (!from || b.updateDate >= from) && (!to || b.updateDate <= to))
        .sort((a, b) => a.updateDate.localeCompare(b.updateDate) || a.number - b.number)
        .map((b) => this.listItem(b));
      return this.page('bills', items, url, path);
    }
    if ((m = /^\/bill\/(\d+)\/([a-z]+)$/.exec(path))) {
      const items = [...this.bills.values()]
        .filter((b) => b.congress === Number(m![1]) && b.type.toLowerCase() === m![2])
        .sort((a, b) => b.number - a.number)
        .map((b) => this.listItem(b));
      return this.page('bills', items, url, path);
    }
    if ((m = /^\/bill\/(\d+)\/([a-z]+)\/(\d+)(?:\/([a-z]+))?$/.exec(path))) {
      const bill = this.bills.get(FakeCongress.key(Number(m[1]), m[2]!, m[3]!));
      if (!bill) return this.json({ error: 'not found' }, 404);
      switch (m[4]) {
        case undefined:
          return this.json(this.detail(bill));
        case 'actions':
          return this.page('actions', bill.actions, url, path);
        case 'cosponsors':
          return this.page('cosponsors', bill.cosponsors, url, path);
        case 'summaries':
          return this.page('summaries', bill.summaries, url, path);
        case 'text':
          return this.page('textVersions', bill.textVersions, url, path);
        case 'titles':
          return this.page('titles', bill.titles, url, path);
        case 'subjects': {
          const limit = Number(url.searchParams.get('limit') ?? 20);
          const offset = Number(url.searchParams.get('offset') ?? 0);
          const all = bill.subjects.map((name) => ({ name, updateDate: bill.updateDate }));
          const slice = all.slice(offset, offset + limit);
          return this.json({
            subjects: {
              legislativeSubjects: slice,
              ...(bill.policyArea ? { policyArea: { name: bill.policyArea } } : {}),
            },
            pagination: { count: all.length, ...(offset + limit < all.length ? { next: 'malformed' } : {}) },
          });
        }
      }
    }
    if ((m = /^\/member\/congress\/(\d+)$/.exec(path))) {
      const current = url.searchParams.get('currentMember') === 'true';
      const items = [...this.members.values()]
        .filter((mem) => !current || mem.current)
        .map((mem) => ({
          bioguideId: mem.bioguideId,
          depiction: mem.imageUrl ? { imageUrl: mem.imageUrl } : undefined,
          district: mem.district,
          name: mem.name,
          partyName: mem.partyName,
          state: mem.state,
          terms: { item: [{ chamber: mem.chamber, startYear: 2025 }] },
          updateDate: mem.updateDate,
        }));
      return this.page('members', items, url, path);
    }
    if ((m = /^\/house-vote\/(\d+)\/(\d)$/.exec(path))) {
      const items = this.houseVotes.filter((v) => v.congress === Number(m![1]) && v.sessionNumber === Number(m![2]));
      return this.page('houseRollCallVotes', items, url, path);
    }
    if ((m = /^\/house-vote\/(\d+)\/(\d)\/(\d+)(\/members)?$/.exec(path))) {
      const key = `${m[1]}-${m[2]}-${m[3]}`;
      const members = this.houseVoteMembers.get(key);
      if (!members) return this.json({ error: 'not found' }, 404);
      if (m[4]) return this.json({ houseRollCallVoteMemberVotes: members });
      const { results: _results, ...rest } = members;
      return this.json({ houseRollCallVote: rest });
    }
    return this.json({ error: `unhandled ${path}` }, 404);
  };
}

/** H.R. 1 (119th) from recorded responses, plus synthetic summaries/text/titles in the documented shapes. */
export function recordedHr1(): UpstreamBill {
  const detail = fixtureJson('congress/bill-hr1.json').bill;
  const actions = fixtureJson('congress/bill-hr1-actions.json').actions;
  const subjects = fixtureJson('congress/bill-hr1-subjects.json').subjects;
  return {
    congress: 119,
    type: 'HR',
    number: 1,
    title: detail.title,
    introducedDate: detail.introducedDate,
    updateDate: detail.updateDate,
    originChamber: 'House',
    sponsor: {
      bioguideId: 'A000375',
      firstName: 'Jodey',
      lastName: 'Arrington',
      party: 'R',
      state: 'TX',
      district: 19,
    },
    policyArea: subjects.policyArea.name,
    actions,
    cosponsors: [],
    subjects: subjects.legislativeSubjects.map((s: { name: string }) => s.name),
    summaries: [
      {
        actionDate: '2025-05-22',
        actionDesc: 'Passed House',
        text: '<p><strong>One Big Beautiful Bill Act</strong></p><p>This bill reduces taxes &amp; changes programs.</p>',
        updateDate: '2025-06-01T00:00:00Z',
        versionCode: '36',
      },
      {
        actionDate: '2025-07-04',
        actionDesc: 'Public Law',
        text: '<p><b>One Big Beautiful Bill Act</b></p><p>This act provides for reconciliation.</p><ul><li>Tax</li><li>Health</li></ul>',
        updateDate: '2025-08-01T00:00:00Z',
        versionCode: '49',
      },
    ],
    textVersions: [
      {
        date: '2025-05-20T04:00:00Z',
        type: 'Introduced in House',
        formats: [{ type: 'Formatted Text', url: 'https://www.congress.gov/119/bills/hr1/BILLS-119hr1ih.htm' }],
      },
      {
        date: '2025-07-04T04:00:00Z',
        type: 'Enrolled Bill',
        formats: [
          { type: 'PDF', url: 'https://www.congress.gov/119/bills/hr1/BILLS-119hr1enr.pdf' },
          { type: 'Formatted Text', url: 'https://www.congress.gov/119/bills/hr1/BILLS-119hr1enr.htm' },
        ],
      },
    ],
    titles: [
      { title: 'One Big Beautiful Bill Act', titleType: 'Short Titles as Introduced' },
      { title: 'One Big Beautiful Bill Act', titleType: 'Short Title(s) as Passed House' },
      {
        title: 'An act to provide for reconciliation pursuant to title II of H. Con. Res. 14.',
        titleType: 'Official Title as Enacted',
      },
    ],
    laws: detail.laws,
  };
}

/** A minimal synthetic bill. */
export function syntheticBill(number: number, updateDate: string, overrides: Partial<UpstreamBill> = {}): UpstreamBill {
  return {
    congress: 119,
    type: 'HR',
    number,
    title: `A bill to test sync number ${number}.`,
    introducedDate: '2026-10-01',
    updateDate,
    originChamber: 'House',
    sponsor: {
      bioguideId: 'A000375',
      firstName: 'Jodey',
      lastName: 'Arrington',
      party: 'R',
      state: 'TX',
      district: 19,
    },
    policyArea: 'Government Operations and Politics',
    actions: [
      {
        actionCode: 'H11100',
        actionDate: '2026-10-01',
        sourceSystem: { code: 2, name: 'House floor actions' },
        text: 'Referred to the House Committee on Oversight and Government Reform.',
        type: 'IntroReferral',
      },
      {
        actionCode: 'Intro-H',
        actionDate: '2026-10-01',
        sourceSystem: { code: 9, name: 'Library of Congress' },
        text: 'Introduced in House',
        type: 'IntroReferral',
      },
    ],
    cosponsors: [],
    subjects: [],
    summaries: [],
    textVersions: [],
    titles: [],
    ...overrides,
  };
}
