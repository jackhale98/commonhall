-- Party unity, the standard measure of party-line voting (as in CQ's vote studies):
-- on roll calls where most Democrats and most Republicans voted on opposite sides,
-- how often each member voted with their own party's majority. Unlike
-- member_vote_stats.with_party, near-unanimous votes don't count, so the scores
-- separate members. The party is the one recorded with each vote; independents
-- (no party majority of their own) are left out.

create or replace view public.member_party_unity
with (security_invoker = true)
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

comment on view public.member_party_unity is
  'Per member, Congress and chamber: party-line roll calls voted on (most D vs most R) and how many with their party''s majority.';

grant select on public.member_party_unity to anon, authenticated;
