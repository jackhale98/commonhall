/**
 * Snapshot the local seed database into site/src/data/demo.json, which the site
 * builds from when no Supabase project is configured (demo mode, PUBLIC_DEMO=true).
 *
 *   npm run db:reset && SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx tsx scripts/export-demo.ts
 */
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';

const url = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(url, { max: 1, onnotice: () => undefined });

const members = await sql`
  select bioguide_id, name, sort_name, party, party_name, state, district, chamber, current, photo_url,
         website, phone, office, contact_form, social
    from public.members order by bioguide_id`;
const bills = await sql`
  select id, congress, bill_type, number, origin_chamber, title, short_title,
         to_char(introduced_date, 'YYYY-MM-DD') as introduced_date, sponsor_id, policy_area,
         to_char(latest_action_date, 'YYYY-MM-DD') as latest_action_date, latest_action_text, status, summary_text,
         text_url, congress_gov_url, law_number, update_date, cosponsors_count
    from public.bills order by latest_action_date desc nulls last, id`;
const actions = await sql`
  select bill_id, seq, to_char(action_date, 'YYYY-MM-DD') as action_date, text, chamber, source_system
    from public.bill_actions order by bill_id, seq`;
const cosponsors = await sql`
  select bill_id, member_id, to_char(sponsored_date, 'YYYY-MM-DD') as sponsored_date,
         to_char(withdrawn_date, 'YYYY-MM-DD') as withdrawn_date, is_original
    from public.bill_cosponsors order by bill_id, member_id`;
const subjects = await sql`select bill_id, subject from public.bill_subjects order by bill_id, subject`;
const votes = await sql`
  select id, chamber, congress, session, roll_number, date, question, title, vote_type, majority_requirement,
         result, bill_id, amendment, yea_total, nay_total, present_total, not_voting_total, source_url
    from public.votes order by date desc nulls last, id desc`;
const positions =
  await sql`select vote_id, member_id, position, party from public.vote_positions order by vote_id, member_id`;
const voteStats = await sql`
  select member_id, congress, total_votes, votes_cast, missed, with_party, party_line_votes from public.member_vote_stats`;

const data = {
  generatedFrom: 'supabase/seed.sql',
  members,
  bills,
  actions,
  cosponsors,
  subjects,
  votes,
  positions,
  voteStats,
};
writeFileSync('site/src/data/demo.json', JSON.stringify(data));
console.log(
  `Wrote site/src/data/demo.json: ${members.length} members, ${bills.length} bills, ${votes.length} votes, ${positions.length} positions`,
);
await sql.end();
