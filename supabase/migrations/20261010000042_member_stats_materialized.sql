-- Member stats as stored tables, refreshed on a schedule.
--
-- member_vote_stats, member_party_unity and member_cosponsor_counts were views that
-- aggregate every vote position or cosponsorship on each read. The site build reads
-- them in pages, so each page re-ran the whole aggregate, and with a full Congress of
-- roll calls one read passed the anon statement timeout and failed the deploy.
-- Materialized, a read is a plain scan; pg_cron refreshes them every 30 minutes
-- (votes sync every 10), and private.refresh_member_stats() refreshes on demand.

drop view if exists public.member_vote_stats;
drop view if exists public.member_party_unity;
drop view if exists public.member_cosponsor_counts;

create materialized view public.member_vote_stats
as
with party_majority as (
  select vote_id, party,
         case
           when count(*) filter (where position = 'yea') > count(*) filter (where position = 'nay') then 'yea'
           when count(*) filter (where position = 'nay') > count(*) filter (where position = 'yea') then 'nay'
         end as majority
    from public.vote_positions
   where party in ('D', 'R') and position in ('yea', 'nay')
   group by vote_id, party
)
select p.member_id,
       v.congress,
       count(*)::integer as total_votes,
       (count(*) filter (where p.position in ('yea', 'nay')))::integer as votes_cast,
       (count(*) filter (where p.position = 'not_voting'))::integer as missed,
       (count(*) filter (where p.position in ('yea', 'nay') and pm.majority = p.position))::integer as with_party,
       (count(*) filter (where p.position in ('yea', 'nay') and pm.majority is not null))::integer as party_line_votes
  from public.vote_positions p
  join public.votes v on v.id = p.vote_id
  left join party_majority pm on pm.vote_id = p.vote_id and pm.party = p.party
 group by p.member_id, v.congress;
create unique index member_vote_stats_key on public.member_vote_stats (member_id, congress);

create materialized view public.member_party_unity
as
with majorities as (
  select vote_id,
         case
           when count(*) filter (where party = 'D' and position = 'yea') > count(*) filter (where party = 'D' and position = 'nay') then 'yea'
           when count(*) filter (where party = 'D' and position = 'nay') > count(*) filter (where party = 'D' and position = 'yea') then 'nay'
         end as d_majority,
         case
           when count(*) filter (where party = 'R' and position = 'yea') > count(*) filter (where party = 'R' and position = 'nay') then 'yea'
           when count(*) filter (where party = 'R' and position = 'nay') > count(*) filter (where party = 'R' and position = 'yea') then 'nay'
         end as r_majority
    from public.vote_positions
   where position in ('yea', 'nay')
   group by vote_id
),
party_votes as (
  select vote_id, d_majority, r_majority
    from majorities
   where d_majority is not null and r_majority is not null and d_majority <> r_majority
)
select p.member_id,
       v.congress,
       v.chamber,
       p.party,
       count(*)::integer as party_votes,
       (count(*) filter (where p.position = case p.party when 'D' then pv.d_majority else pv.r_majority end))::integer
         as with_party
  from public.vote_positions p
  join party_votes pv on pv.vote_id = p.vote_id
  join public.votes v on v.id = p.vote_id
 where p.position in ('yea', 'nay') and p.party in ('D', 'R')
 group by p.member_id, v.congress, v.chamber, p.party;
create unique index member_party_unity_key on public.member_party_unity (member_id, congress, chamber, party);

create materialized view public.member_cosponsor_counts
as
select member_id, split_part(bill_id, '-', 1)::integer as congress, count(*)::integer as cosponsored
  from public.bill_cosponsors
 where withdrawn_date is null
 group by member_id, split_part(bill_id, '-', 1);
create unique index member_cosponsor_counts_key on public.member_cosponsor_counts (member_id, congress);

grant select on public.member_vote_stats, public.member_party_unity, public.member_cosponsor_counts to anon, authenticated;

comment on materialized view public.member_party_unity is
  'Per member, Congress and chamber: party-line roll calls voted on (most D vs most R) and how many with their party''s majority.';

create or replace function private.refresh_member_stats()
returns void
language sql
security definer
set search_path = ''
as $$
  refresh materialized view concurrently public.member_vote_stats;
  refresh materialized view concurrently public.member_party_unity;
  refresh materialized view concurrently public.member_cosponsor_counts;
$$;

select cron.schedule('refresh-member-stats', '3,33 * * * *', $$select private.refresh_member_stats()$$);
