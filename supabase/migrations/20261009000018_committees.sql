-- Congressional committees: committees and subcommittees with their members
-- (congress-legislators), the committees each bill was sent to (from the bill's
-- actions), and hearings and markups (Congress.gov). Kept current by sync-committees.

create table public.committees (
  /** Congress.gov system code: hsag00 (committee), hsag15 (subcommittee). */
  code text primary key check (code ~ '^[a-z]{4}[0-9]{2}$'),
  parent_code text references public.committees (code) on delete cascade,
  chamber text not null check (chamber in ('house', 'senate', 'joint')),
  name text not null,
  url text,
  jurisdiction text,
  address text,
  phone text,
  current boolean not null default true
);

comment on table public.committees is 'Committees and subcommittees of Congress (congress-legislators).';
create index committees_parent_idx on public.committees (parent_code);

create table public.committee_members (
  committee_code text not null references public.committees (code) on delete cascade,
  /** Bioguide id; no foreign key, so a roster loads even before a new member does. */
  member_id text not null,
  side text not null check (side in ('majority', 'minority')),
  rank smallint not null,
  /** Chairman, Ranking Member, Vice Chair, … */
  title text,
  primary key (committee_code, member_id)
);

create index committee_members_member_idx on public.committee_members (member_id);

create table public.bill_committees (
  bill_id text not null references public.bills (id) on delete cascade,
  /** No foreign key: actions can name committees that no longer exist. */
  committee_code text not null,
  committee_name text,
  referred_date date,
  reported_date date,
  last_action_date date,
  last_action_text text,
  primary key (bill_id, committee_code)
);

comment on table public.bill_committees is 'Committees named in a bill''s actions: first referral, first report, latest committee action.';
create index bill_committees_committee_idx on public.bill_committees (committee_code, last_action_date desc);

alter table public.bills add column committees_checked boolean not null default false;
comment on column public.bills.committees_checked is 'bill_committees has been filled from this bill''s actions.';
create index bills_committees_unchecked_idx on public.bills (latest_action_date desc) where not committees_checked;

create table public.committee_meetings (
  /** {congress}-{chamber}-{eventId} */
  id text primary key,
  congress smallint not null,
  chamber text not null check (chamber in ('house', 'senate', 'joint')),
  event_id text not null,
  date timestamptz,
  title text,
  meeting_type text,
  status text,
  location text,
  committee_codes text[] not null default '{}',
  committee_names text[] not null default '{}',
  witnesses jsonb not null default '[]'::jsonb,
  bill_ids text[] not null default '{}',
  video_url text,
  url text not null,
  source_updated_at timestamptz
);

comment on table public.committee_meetings is 'Committee hearings and markups (Congress.gov).';
create index committee_meetings_date_idx on public.committee_meetings (date desc);
create index committee_meetings_committees_idx on public.committee_meetings using gin (committee_codes);

alter table public.committees enable row level security;
alter table public.committee_members enable row level security;
alter table public.bill_committees enable row level security;
alter table public.committee_meetings enable row level security;
create policy "Public read" on public.committees for select to anon, authenticated using (true);
create policy "Public read" on public.committee_members for select to anon, authenticated using (true);
create policy "Public read" on public.bill_committees for select to anon, authenticated using (true);
create policy "Public read" on public.committee_meetings for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.committees, public.committee_members, public.bill_committees,
  public.committee_meetings from anon, authenticated;

-- Hourly: rosters once a day, new or changed meetings, and a batch of older bills' referrals.
select cron.schedule('sync-committees', '5 * * * *', $$select private.invoke_sync('sync-committees')$$);
