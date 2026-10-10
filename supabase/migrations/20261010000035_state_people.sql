-- State legislators' contact details and state committees, from Open States' people
-- repository (github.com/openstates/people, CC0), loaded weekly by the "Load state
-- people and committees" workflow. And every sponsor of each state bill, not just
-- the first, from the Open States bills the state sync already reads.

alter table public.state_legislators
  add column if not exists offices jsonb not null default '[]'::jsonb,
  add column if not exists links jsonb not null default '[]'::jsonb,
  add column if not exists people_synced_at timestamptz;

comment on column public.state_legislators.offices is
  'Offices from openstates/people: [{classification, address, voice, fax}].';
comment on column public.state_legislators.links is 'Official and campaign web pages (URLs).';

create table public.state_committees (
  id text primary key check (id like 'ocd-organization/%'),
  state char(2) not null,
  name text not null,
  chamber text check (chamber in ('upper', 'lower', 'legislature')),
  classification text not null default 'committee',
  parent_id text,
  url text,
  member_count integer not null default 0,
  synced_at timestamptz not null default now()
);

create index state_committees_state_idx on public.state_committees (state, chamber, name);

create table public.state_committee_members (
  committee_id text not null references public.state_committees (id) on delete cascade,
  seq smallint not null,
  person_id text,
  name text not null,
  role text,
  primary key (committee_id, seq)
);

comment on column public.state_committee_members.person_id is
  'Open States person id; may not be in state_legislators (e.g. a member who has left).';

create index state_committee_members_person_idx on public.state_committee_members (person_id)
  where person_id is not null;

create table public.state_bill_sponsors (
  bill_id text not null references public.state_bills (id) on delete cascade,
  seq smallint not null,
  person_id text,
  name text not null,
  is_primary boolean not null default false,
  classification text,
  primary key (bill_id, seq)
);

create index state_bill_sponsors_person_idx on public.state_bill_sponsors (person_id)
  where person_id is not null;

alter table public.state_committees enable row level security;
alter table public.state_committee_members enable row level security;
alter table public.state_bill_sponsors enable row level security;
create policy "Public read" on public.state_committees for select to anon, authenticated using (true);
create policy "Public read" on public.state_committee_members for select to anon, authenticated using (true);
create policy "Public read" on public.state_bill_sponsors for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.state_committees, public.state_committee_members,
  public.state_bill_sponsors from anon, authenticated;
grant select on public.state_committees, public.state_committee_members, public.state_bill_sponsors
  to anon, authenticated;
