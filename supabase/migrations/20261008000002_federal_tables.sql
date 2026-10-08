-- Phase 1: federal bills and members.
--
-- Readable by anyone (anon and authenticated), writable only by the service role.
-- Raw API payloads are not stored. The *_count columns hold the sub-endpoint
-- counts from the last bill detail fetch so the hourly sync can skip sub-fetches
-- whose counts have not changed.

create table public.members (
  bioguide_id text primary key,
  name text not null,
  sort_name text,
  first_name text,
  last_name text,
  party char(1),
  party_name text,
  state char(2),
  district smallint,
  chamber text check (chamber in ('house', 'senate')),
  current boolean not null default false,
  photo_url text,
  lis_id text,
  website text,
  phone text,
  office text,
  contact_form text,
  social jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on column public.members.district is 'House district; 0 for at-large seats and delegates; null for senators.';
comment on column public.members.lis_id is 'Senate LIS member ID, used to map senate.gov votes.';

create unique index members_lis_id_key on public.members (lis_id) where lis_id is not null;
create index members_state_idx on public.members (state, chamber) where current;

create table public.bills (
  id text primary key check (id ~ '^[0-9]+-[a-z]+-[0-9]+$'),
  congress smallint not null,
  bill_type text not null check (bill_type in ('hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres')),
  number integer not null,
  origin_chamber text check (origin_chamber in ('house', 'senate')),
  title text not null,
  short_title text,
  introduced_date date,
  sponsor_id text references public.members (bioguide_id),
  policy_area text,
  latest_action_date date,
  latest_action_text text,
  status text not null default 'introduced' check (
    status in ('introduced', 'in_committee', 'passed_house', 'passed_senate', 'passed_both', 'agreed', 'to_president', 'vetoed', 'law')
  ),
  summary_text text,
  text_url text,
  congress_gov_url text,
  law_number text,
  update_date timestamptz,
  update_date_including_text timestamptz,
  actions_count integer not null default 0,
  cosponsors_count integer not null default 0,
  summaries_count integer not null default 0,
  subjects_count integer not null default 0,
  text_versions_count integer not null default 0,
  titles_count integer not null default 0,
  synced_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(short_title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary_text, '')), 'C')
  ) stored,
  unique (congress, bill_type, number)
);

comment on column public.bills.id is '{congress}-{bill type lowercased}-{number}, e.g. 119-hr-1234';
comment on column public.bills.status is 'Derived from actions by deriveStatus() in packages/congress-client/src/status.ts';

create index bills_update_date_idx on public.bills (update_date desc);
create index bills_sponsor_idx on public.bills (sponsor_id);
create index bills_latest_action_idx on public.bills (latest_action_date desc nulls last);
create index bills_congress_type_idx on public.bills (congress, bill_type, number);
create index bills_search_idx on public.bills using gin (search);

create table public.bill_actions (
  bill_id text not null references public.bills (id) on delete cascade,
  seq integer not null,
  action_date date,
  action_time time,
  text text not null,
  action_code text,
  action_type text,
  chamber text check (chamber in ('house', 'senate')),
  source_system text,
  primary key (bill_id, seq)
);

comment on column public.bill_actions.seq is '1 = oldest action. Actions are replaced as a set when the count changes.';

create index bill_actions_bill_date_idx on public.bill_actions (bill_id, action_date desc);

create table public.bill_cosponsors (
  bill_id text not null references public.bills (id) on delete cascade,
  member_id text not null references public.members (bioguide_id),
  sponsored_date date,
  withdrawn_date date,
  is_original boolean not null default false,
  primary key (bill_id, member_id)
);

create index bill_cosponsors_member_idx on public.bill_cosponsors (member_id);

create table public.bill_subjects (
  bill_id text not null references public.bills (id) on delete cascade,
  subject text not null,
  primary key (bill_id, subject)
);

create index bill_subjects_subject_idx on public.bill_subjects (subject);

-- Row-level security: public read, service-role write (service role bypasses RLS).
alter table public.members enable row level security;
alter table public.bills enable row level security;
alter table public.bill_actions enable row level security;
alter table public.bill_cosponsors enable row level security;
alter table public.bill_subjects enable row level security;

create policy "Public read" on public.members for select to anon, authenticated using (true);
create policy "Public read" on public.bills for select to anon, authenticated using (true);
create policy "Public read" on public.bill_actions for select to anon, authenticated using (true);
create policy "Public read" on public.bill_cosponsors for select to anon, authenticated using (true);
create policy "Public read" on public.bill_subjects for select to anon, authenticated using (true);

-- Defence in depth: even if a write policy were added by mistake, these roles have no write grants.
revoke insert, update, delete, truncate on public.members, public.bills, public.bill_actions,
  public.bill_cosponsors, public.bill_subjects from anon, authenticated;

-- Full-text search used by the site's search box (PostgREST RPC: /rpc/search_bills).
create or replace function public.search_bills(q text, max_results integer default 50)
returns setof public.bills
language sql
stable
set search_path = ''
as $$
  select b.*
    from public.bills b
   where b.search @@ websearch_to_tsquery('english', q)
   order by ts_rank(b.search, websearch_to_tsquery('english', q)) desc,
            b.latest_action_date desc nulls last
   limit least(greatest(max_results, 1), 200);
$$;

grant execute on function public.search_bills(text, integer) to anon, authenticated;
