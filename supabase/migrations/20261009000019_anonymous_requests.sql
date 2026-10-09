-- Signed-out visitors can ask for a discussion. Each browser keeps a random id
-- (localStorage) so one browser counts once per item and can take its request
-- back. The table is reachable only through these functions; nobody can read it.

create table public.discussion_requests_anon (
  client_id uuid not null,
  target_type text not null
    check (target_type in ('bill', 'state_bill', 'local_matter', 'executive_order', 'scotus_case')),
  target_id text not null check (length(target_id) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (client_id, target_type, target_id)
);

comment on table public.discussion_requests_anon is
  'Discussion requests from signed-out browsers, keyed by a random per-browser id. No personal data.';
create index discussion_requests_anon_target_idx on public.discussion_requests_anon (target_type, target_id);
create index discussion_requests_anon_created_idx on public.discussion_requests_anon (created_at);

alter table public.discussion_requests_anon enable row level security;
revoke all on public.discussion_requests_anon from anon, authenticated;

-- Add or remove this browser's request. Bounded: at most 300 new anonymous
-- requests an hour site-wide, so a script cannot flood the counts.
create or replace function public.set_anonymous_discussion_request(
  p_client_id uuid, p_target_type text, p_target_id text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_on then
    if (select count(*) from public.discussion_requests_anon where created_at > now() - interval '1 hour') >= 300 then
      raise exception 'Too many requests right now; please try again later.';
    end if;
    insert into public.discussion_requests_anon (client_id, target_type, target_id)
    values (p_client_id, p_target_type, p_target_id)
    on conflict do nothing;
  else
    delete from public.discussion_requests_anon
     where client_id = p_client_id and target_type = p_target_type and target_id = p_target_id;
  end if;
end;
$$;

create or replace function public.has_anonymous_discussion_request(
  p_client_id uuid, p_target_type text, p_target_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.discussion_requests_anon
     where client_id = p_client_id and target_type = p_target_type and target_id = p_target_id);
$$;

grant execute on function public.set_anonymous_discussion_request(uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.has_anonymous_discussion_request(uuid, text, text) to anon, authenticated;

-- Counts and the admin summary include both kinds of request.
create or replace function public.discussion_request_count(p_target_type text, p_target_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select ((select count(*) from public.discussion_requests where target_type = p_target_type and target_id = p_target_id)
        + (select count(*) from public.discussion_requests_anon where target_type = p_target_type and target_id = p_target_id))::integer;
$$;

create or replace function public.discussion_request_summary()
returns table (target_type text, target_id text, requests integer, latest timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.target_type, r.target_id, count(*)::integer, max(r.created_at)
    from (
      select target_type, target_id, created_at from public.discussion_requests
      union all
      select target_type, target_id, created_at from public.discussion_requests_anon
    ) r
   where public.is_admin()
   group by r.target_type, r.target_id
   order by count(*) desc, max(r.created_at) desc
   limit 200;
$$;
