-- Member pages list a member's votes live; give each the bill's short title, so the
-- list says what was voted on, not only "On Passage". Columns are only added at the end.
create or replace view public.member_votes
with (security_invoker = true)
as
select p.member_id, p.position, p.party, v.id as vote_id, v.chamber, v.congress, v.session, v.roll_number, v.date,
       v.question, v.title, v.result, v.bill_id, v.yea_total, v.nay_total,
       coalesce(b.short_title, b.title) as bill_title
  from public.vote_positions p
  join public.votes v on v.id = p.vote_id
  left join public.bills b on b.id = v.bill_id;

grant select on public.member_votes to anon, authenticated;
