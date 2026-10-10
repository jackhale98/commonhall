-- Retention and upkeep (October 2026 audit).

-- 1. Past Congresses keep the history of bills that moved. trim_past_congresses used
--    to drop every past bill's actions and cosponsors once a new Congress began, so a
--    2025 law would have lost its timeline in January 2027. Now only bills that never
--    left committee lose them (most bills; their status and latest action stay), and
--    members' roll-call positions are kept for the Congress just ended.
create or replace function private.trim_past_congresses()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_c integer := private.current_congress();
  actions integer;
  cosponsors integer;
  positions integer;
begin
  delete from public.bill_actions a using public.bills b
   where b.id = a.bill_id and b.congress < current_c and b.status in ('introduced', 'in_committee');
  get diagnostics actions = row_count;
  delete from public.bill_cosponsors c using public.bills b
   where b.id = c.bill_id and b.congress < current_c and b.status in ('introduced', 'in_committee');
  get diagnostics cosponsors = row_count;
  delete from public.vote_positions p using public.votes v
   where v.id = p.vote_id and v.congress < current_c - 1;
  get diagnostics positions = row_count;
  return jsonb_build_object('congress', current_c, 'actions', actions, 'cosponsors', cosponsors, 'positions', positions);
end;
$$;

revoke all on function private.trim_past_congresses() from public, anon, authenticated;

-- 2. Feed events older than six months: the feed shows recent activity, and the table
--    gains a row for every bill change (about 300 a day).
select cron.schedule('purge-feed-events', '29 3 * * *',
  $$delete from public.feed_events where occurred_at < now() - interval '180 days'$$);

-- 3. Indexes nothing needs: one duplicates the unique constraint on (congress,
--    bill_type, number); a bill's actions are always read by (bill_id, seq), the key.
drop index if exists public.bills_congress_type_idx;
drop index if exists public.bill_actions_bill_date_idx;

-- 4. Member statistics were rebuilt every 30 minutes whether or not anything changed
--    (a full read of every vote position and cosponsorship). Now only after the votes
--    or bills sync wrote something since the last rebuild.
create or replace function private.refresh_member_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed timestamptz;
  refreshed timestamptz;
begin
  select max(last_progress_at) into changed
    from public.sync_state where job in ('federal-votes', 'federal-bills');
  select last_success_at into refreshed from public.sync_state where job = 'member-stats';
  if refreshed is not null and (changed is null or changed <= refreshed) then
    return;
  end if;
  refresh materialized view concurrently public.member_vote_stats;
  refresh materialized view concurrently public.member_party_unity;
  refresh materialized view concurrently public.member_cosponsor_counts;
  insert into public.sync_state (job, last_success_at, updated_at) values ('member-stats', now(), now())
  on conflict (job) do update set last_success_at = now(), updated_at = now();
end;
$$;

revoke all on function private.refresh_member_stats() from public, anon, authenticated;
