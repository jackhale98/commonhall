-- Per-client limits on what the public can write or trigger (CLAUDE.md rule 7; review
-- items 3, 5 and 7; docs/decisions.md §106).
--
-- * private.rate_limits counts hits per bucket and client in fixed windows. The client
--   is a hash of the caller's IP address with the day mixed in, so no address is
--   stored and keys can't be linked across days; rows are purged after a day.
-- * Anonymous discussion requests: the site-wide cap of 300 an hour stays, and each
--   client (by address, and by its browser id, which the caller chooses) may add 20
--   an hour. Requests older than 180 days are purged, like feed events.
-- * Signed-in discussion requests: at most 300 per user, like follows (500).
-- * profiles: signed-in users may write only their own address fields, not
--   polis_xid (the random id Pol.is sees). TRUNCATE, which row-level security does
--   not cover, is revoked from users on the per-user tables.
--
-- No upstream requests: this changes no synced data.

create table private.rate_limits (
  bucket text not null,
  client text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, client, window_start)
);

comment on table private.rate_limits is
  'Hits per bucket and client (a daily-salted hash of the IP address, never the address), per window.';

-- The caller's IP address from the request PostgREST is serving (null outside a request).
create or replace function private.request_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(trim(split_part(coalesce(
           nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
           nullif(current_setting('request.headers', true), '')::json ->> 'x-real-ip',
           nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
           ''), ',', 1)), '');
$$;

-- A client key: the address hashed with the day, so the same client counts as one
-- within a day and nothing identifying is kept.
create or replace function private.client_key(p_ip text)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_ip is null then null
         else encode(sha256(convert_to(p_ip || '|' || current_date::text, 'UTF8')), 'hex') end;
$$;

-- Count one hit and say whether the client is within its limit (true) or over it.
create or replace function private.hit_rate_limit(p_bucket text, p_client text, p_max integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  if p_client is null then
    return true;
  end if;
  insert into private.rate_limits as r (bucket, client, window_start, hits)
  values (p_bucket, p_client, date_bin(p_window, now(), timestamptz '2000-01-01'), 1)
  on conflict (bucket, client, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

revoke all on function private.request_ip() from public, anon, authenticated;
revoke all on function private.client_key(text) from public, anon, authenticated;
revoke all on function private.hit_rate_limit(text, text, integer, interval) from public, anon, authenticated;

select cron.schedule('purge-rate-limits', '37 3 * * *',
  $$delete from private.rate_limits where window_start < now() - interval '1 day'$$);

-- Anonymous discussion requests: per client as well as site-wide.
create or replace function public.set_anonymous_discussion_request(
  p_client_id uuid, p_target_type text, p_target_id text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_on then
    if not private.hit_rate_limit('discussion-request-anon', private.client_key(private.request_ip()), 20, interval '1 hour')
       or not private.hit_rate_limit('discussion-request-anon-id', p_client_id::text, 20, interval '1 hour') then
      raise exception 'Too many requests from you right now; please try again later.';
    end if;
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

select cron.schedule('purge-discussion-requests-anon', '41 3 * * *',
  $$delete from public.discussion_requests_anon where created_at < now() - interval '180 days'$$);

-- Signed-in discussion requests: at most 300 per user.
create or replace function private.enforce_discussion_request_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.discussion_requests where user_id = new.user_id) >= 300 then
    raise exception 'You can ask for at most 300 discussions' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger discussion_requests_limit before insert on public.discussion_requests
  for each row execute function private.enforce_discussion_request_limit();

-- profiles: users write their own address fields only; polis_xid is set by the database.
revoke insert, update on public.profiles from authenticated;
grant insert (user_id, address_label, state, congressional_district, state_upper_district, state_lower_district,
              city, council_district, updated_at)
  on public.profiles to authenticated;
grant update (user_id, address_label, state, congressional_district, state_upper_district, state_lower_district,
              city, council_district, updated_at)
  on public.profiles to authenticated;

revoke truncate on public.profiles, public.follows, public.feed_reads, public.discussion_requests
  from anon, authenticated;
