-- Feed: a vote by a followed member says what it was about. The payload gains the
-- vote's official title ("Confirmation: Keith Sonderling, of F.L., to be Secretary
-- of Labor") and the bill's short title, so a card can read "On cloture" plus the
-- bill or nominee without opening the roll call. Otherwise unchanged (migration 008).

create or replace view public.feed
with (security_invoker = true)
as
with mine as (
  select target_type, target_id from public.follows where user_id = (select auth.uid())
),
seen as (
  select coalesce((select last_seen_at from public.feed_reads where user_id = (select auth.uid())), '-infinity'::timestamptz) as at
),
matched as (
  select e.*, 'target'::text as reason
    from public.feed_events e
    join mine m on m.target_type = e.target_type and m.target_id = e.target_id
  union
  select e.*, 'legislator'::text as reason
    from public.feed_events e
    join mine m on m.target_type = e.member_type and m.target_id = e.member_id
),
events as (
  select distinct on (m.id)
    m.id, m.target_type, m.target_id, m.kind, m.member_type, m.member_id, m.occurred_at, m.created_at,
    m.summary, m.payload, m.reason
  from matched m
  order by m.id, m.reason desc
),
member_votes as (
  select null::bigint as id, 'member'::text as target_type, p.member_id as target_id, 'vote'::text as kind,
         'member'::text as member_type, p.member_id, coalesce(v.date, v.created_at) as occurred_at, v.created_at,
         format('%s voted %s: %s', mem.name,
                case p.position when 'yea' then 'yes' when 'nay' then 'no' when 'present' then 'present' else 'did not vote' end,
                coalesce(v.question, 'roll call ' || v.roll_number)) as summary,
         jsonb_build_object('vote_id', v.id, 'position', p.position, 'result', v.result, 'bill_id', v.bill_id,
                            'chamber', v.chamber, 'question', v.question, 'title', v.title,
                            'bill_title', coalesce(b.short_title, b.title)) as payload,
         'legislator'::text as reason
    from mine m
    join public.vote_positions p on m.target_type = 'member' and p.member_id = m.target_id
    join public.votes v on v.id = p.vote_id
    join public.members mem on mem.bioguide_id = p.member_id
    left join public.bills b on b.id = v.bill_id
),
official_votes as (
  select null::bigint as id, 'local_official'::text as target_type, p.official_id as target_id, 'vote'::text as kind,
         'local_official'::text as member_type, p.official_id as member_id,
         coalesce(v.meeting_date::timestamptz, v.created_at) as occurred_at, v.created_at,
         format('%s voted %s: %s', o.name,
                case p.position when 'yea' then 'yes' when 'nay' then 'no' when 'present' then 'present' else 'did not vote' end,
                coalesce(v.question, 'council vote')) as summary,
         jsonb_build_object('local_vote_id', v.id, 'position', p.position, 'result', v.result, 'matter_id', v.matter_id) as payload,
         'legislator'::text as reason
    from mine m
    join public.local_vote_positions p on m.target_type = 'local_official' and p.official_id = m.target_id
    join public.local_votes v on v.id = p.vote_id
    join public.local_officials o on o.id = p.official_id
)
select x.*, x.created_at > (select at from seen) as unread
  from (select * from events union all select * from member_votes union all select * from official_votes) x;

grant select on public.feed to authenticated;
