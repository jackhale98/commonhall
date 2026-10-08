/**
 * Build supabase/seed.sql: a small, real dataset for local development so no
 * API key is needed to work on the UI.
 *
 *   npx tsx scripts/make-seed.ts --bills <bill list JSON> --legislators <legislators-current.json> [--count 50]
 *
 * Inputs are raw responses saved from the public APIs:
 *   - a Congress.gov `/bill/{congress}?limit=250` page (list items only),
 *   - congress-legislators `legislators-current.json` (public domain),
 *   - the recorded H.R. 1 fixtures in packages/congress-client/test/fixtures, which
 *     give one fully populated bill (actions, subjects, sponsor).
 * List-only bills have one action (their latest) and no sponsor; that is what the
 * list endpoint provides, and the UI must cope with it anyway.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  billId,
  congressGovBillUrl,
  deriveStatus,
  summarizeLegislator,
  type BillAction,
  type BillDetail,
  type BillListItem,
  type Legislator,
} from '@civic/congress-client';
import { actionRows, partyCode, partyName, toDate, toTimestamp } from '@civic/sync';

type Value = string | number | boolean | null | Record<string, unknown>;

function lit(value: Value | undefined): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return `${lit(JSON.stringify(value))}::jsonb`;
  return `'${value.replace(/'/g, "''")}'`;
}

function insert(table: string, rows: Record<string, Value | undefined>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]!);
  const values = rows.map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n');
  return `insert into public.${table} (${cols.join(', ')}) values\n${values};\n\n`;
}

const fixtures = new URL('../packages/congress-client/test/fixtures/congress/', import.meta.url);
const readJson = <T>(path: string | URL): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function main() {
  const { values } = parseArgs({
    options: {
      bills: { type: 'string' },
      legislators: { type: 'string' },
      count: { type: 'string', default: '50' },
      out: { type: 'string', default: 'supabase/seed.sql' },
    },
  });
  if (!values.bills || !values.legislators) {
    console.error('Usage: make-seed.ts --bills <bill list JSON> --legislators <legislators-current.json>');
    process.exit(2);
  }
  const count = Number(values.count);

  // Members: everyone currently serving, from congress-legislators.
  const legislators = readJson<Legislator[]>(values.legislators);
  const recordedMembers = readJson<{ members: { bioguideId: string; depiction?: { imageUrl?: string } }[] }>(
    new URL('members-list.json', fixtures),
  ).members;
  const photos = new Map(recordedMembers.map((m) => [m.bioguideId, m.depiction?.imageUrl ?? null]));
  const members = legislators
    .map(summarizeLegislator)
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => a.bioguideId.localeCompare(b.bioguideId))
    .map((m) => {
      const leg = legislators.find((l) => l.id.bioguide === m.bioguideId)!;
      const party = partyCode(m.party);
      return {
        bioguide_id: m.bioguideId,
        name: m.name ?? m.bioguideId,
        sort_name: [leg.name.last, leg.name.first].filter(Boolean).join(', '),
        first_name: leg.name.first ?? null,
        last_name: leg.name.last ?? null,
        party,
        party_name: partyName(party),
        state: m.state,
        district: m.district,
        chamber: m.chamber,
        current: true,
        photo_url: photos.get(m.bioguideId) ?? null,
        lis_id: m.lisId,
        website: m.website,
        phone: m.phone,
        office: m.office,
        contact_form: m.contactForm,
      };
    });
  const memberIds = new Set(members.map((m) => m.bioguide_id));

  // H.R. 1, fully populated from recorded responses.
  const hr1 = readJson<{ bill: BillDetail }>(new URL('bill-hr1.json', fixtures)).bill;
  const hr1Actions = readJson<{ actions: BillAction[] }>(new URL('bill-hr1-actions.json', fixtures)).actions;
  const hr1Subjects = readJson<{ subjects: { legislativeSubjects: { name: string }[] } }>(
    new URL('bill-hr1-subjects.json', fixtures),
  ).subjects.legislativeSubjects;
  const hr1Id = billId(119, 'hr', 1);
  const bills: Record<string, Value | undefined>[] = [
    {
      id: hr1Id,
      congress: 119,
      bill_type: 'hr',
      number: 1,
      origin_chamber: 'house',
      title: hr1.title!,
      short_title: 'One Big Beautiful Bill Act',
      introduced_date: toDate(hr1.introducedDate),
      sponsor_id: memberIds.has(hr1.sponsors?.[0]?.bioguideId ?? '') ? hr1.sponsors![0]!.bioguideId! : null,
      policy_area: hr1.policyArea?.name ?? null,
      latest_action_date: toDate(hr1.latestAction?.actionDate),
      latest_action_text: hr1.latestAction?.text ?? null,
      status: deriveStatus('hr', hr1Actions),
      congress_gov_url: hr1.legislationUrl ?? congressGovBillUrl(119, 'hr', 1),
      law_number: hr1.laws?.[0]?.number ?? null,
      update_date: toTimestamp(hr1.updateDate),
      actions_count: hr1Actions.length,
      subjects_count: hr1Subjects.length + 1,
    },
  ];
  const actions = actionRows(hr1Id, hr1Actions).map((a) => ({ ...a }));
  const subjects = hr1Subjects.map((s) => ({ bill_id: hr1Id, subject: s.name }));

  // A spread of bill types from the recorded list page.
  const list = readJson<{ bills: BillListItem[] }>(values.bills).bills;
  const byType = new Map<string, BillListItem[]>();
  for (const b of list) byType.set(b.type!, [...(byType.get(b.type!) ?? []), b]);
  const picked: BillListItem[] = [];
  while (picked.length < count - 1 && [...byType.values()].some((v) => v.length > 0)) {
    for (const items of byType.values()) {
      const next = items.shift();
      if (next && picked.length < count - 1) picked.push(next);
    }
  }
  for (const b of picked) {
    const type = b.type!.toLowerCase();
    const id = billId(b.congress!, type, b.number!);
    const latest: BillAction = { actionDate: b.latestAction?.actionDate, text: b.latestAction?.text };
    bills.push({
      id,
      congress: b.congress!,
      bill_type: type,
      number: Number(b.number),
      origin_chamber: b.originChamber?.toLowerCase().startsWith('h') ? 'house' : 'senate',
      title: b.title!,
      short_title: null,
      introduced_date: toDate(b.introducedDate),
      sponsor_id: null,
      policy_area: null,
      latest_action_date: toDate(b.latestAction?.actionDate),
      latest_action_text: b.latestAction?.text ?? null,
      status: deriveStatus(type, [latest]),
      congress_gov_url: congressGovBillUrl(b.congress!, type, b.number!),
      law_number: null,
      update_date: toTimestamp(b.updateDate),
      actions_count: 1,
      subjects_count: 0,
    });
    actions.push(...actionRows(id, [latest]));
  }

  const header = `-- Local development seed: ${members.length} current members and ${bills.length} bills (119th Congress).
-- Generated by scripts/make-seed.ts from public-domain sources (Congress.gov responses
-- recorded in packages/congress-client/test/fixtures and congress-legislators).
-- Regenerate rather than editing by hand.

`;
  const sql =
    header +
    insert('members', members) +
    insert('bills', bills) +
    insert('bill_actions', actions as unknown as Record<string, Value>[]) +
    insert('bill_subjects', subjects);
  writeFileSync(values.out!, sql);
  console.log(`Wrote ${values.out}: ${members.length} members, ${bills.length} bills, ${actions.length} actions.`);
}

main();
