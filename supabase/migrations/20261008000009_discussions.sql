-- Discussions (Pol.is). Maintainers (rows in `admins`) create discussions; each
-- embeds a hosted Pol.is conversation whose page ID is the discussion ID.
-- The only user identifier ever sent to Pol.is is profiles.polis_xid.

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'moderator' check (role in ('admin', 'moderator')),
  created_at timestamptz not null default now()
);

comment on table public.admins is 'Maintainers who may create and edit discussions. Add rows with the service role (SQL editor).';

alter table public.admins enable row level security;
-- A signed-in user can see whether they themselves are an admin; nobody can see the list.
create policy "Own admin row" on public.admins for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- A random, stable identifier per user for Pol.is (never the auth id, email or address).
alter table public.profiles add column polis_xid uuid not null default gen_random_uuid();
alter table public.profiles add constraint profiles_polis_xid_key unique (polis_xid);

create table public.discussions (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  title text not null check (length(title) between 3 and 200),
  prompt text not null check (length(prompt) between 10 and 2000),
  jurisdiction text not null check (jurisdiction in ('federal', 'ma', 'boston')),
  district smallint,
  target_type text check (target_type in ('bill', 'state_bill', 'local_matter')),
  target_id text,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  residency_required boolean not null default false,
  opens_at timestamptz,
  closes_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((target_type is null) = (target_id is null)),
  check (district is null or jurisdiction = 'boston'),
  check (closes_at is null or opens_at is null or closes_at > opens_at)
);

comment on column public.discussions.id is 'Short slug, also used as the Pol.is page_id.';
comment on column public.discussions.district is 'Boston council district the discussion is for, if any.';
comment on column public.discussions.residency_required is 'Honor system: only users whose saved address is in the jurisdiction (and district) may vote or write.';

create index discussions_target_idx on public.discussions (target_type, target_id) where target_id is not null;
create index discussions_status_idx on public.discussions (status, jurisdiction);

alter table public.discussions enable row level security;
create policy "Public read of published discussions" on public.discussions for select to anon, authenticated
  using (status <> 'draft' or (select public.is_admin()));
create policy "Admins insert" on public.discussions for insert to authenticated with check ((select public.is_admin()));
create policy "Admins update" on public.discussions for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins delete" on public.discussions for delete to authenticated using ((select public.is_admin()));
revoke insert, update, delete, truncate on public.discussions from anon;

create or replace function private.discussions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger discussions_before_write before insert or update on public.discussions
  for each row execute function private.discussions_before_write();

-- When a discussion opens, tell followers of the linked bill or matter (or of the discussion).
create or replace function private.discussion_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    insert into public.feed_events (target_type, target_id, kind, occurred_at, summary, payload, dedupe_key)
    values (
      coalesce(new.target_type, 'discussion'),
      coalesce(new.target_id, new.id),
      'discussion_opened',
      coalesce(new.opens_at, now()),
      'New discussion: ' || new.title,
      jsonb_build_object('discussion_id', new.id, 'title', new.title, 'jurisdiction', new.jurisdiction),
      'discussion_opened:' || new.id
    )
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger discussions_opened after insert or update of status on public.discussions
  for each row execute function private.discussion_opened();

-- Requests for a discussion on a bill or council matter.
create table public.discussion_requests (
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('bill', 'state_bill', 'local_matter')),
  target_id text not null check (length(target_id) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create index discussion_requests_target_idx on public.discussion_requests (target_type, target_id);

alter table public.discussion_requests enable row level security;
create policy "Own requests" on public.discussion_requests for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Admins read all requests" on public.discussion_requests for select to authenticated
  using ((select public.is_admin()));
revoke all on public.discussion_requests from anon;

-- Public count of requests for one item (never who asked).
create or replace function public.discussion_request_count(p_target_type text, p_target_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.discussion_requests where target_type = p_target_type and target_id = p_target_id;
$$;

grant execute on function public.discussion_request_count(text, text) to anon, authenticated;

-- Most-requested items, for the admin page.
create or replace function public.discussion_request_summary()
returns table (target_type text, target_id text, requests integer, latest timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.target_type, r.target_id, count(*)::integer, max(r.created_at)
    from public.discussion_requests r
   where public.is_admin()
   group by r.target_type, r.target_id
   order by count(*) desc, max(r.created_at) desc
   limit 200;
$$;

revoke all on function public.discussion_request_summary() from public, anon;
grant execute on function public.discussion_request_summary() to authenticated;
