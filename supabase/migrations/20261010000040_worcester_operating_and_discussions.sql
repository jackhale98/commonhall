-- Worcester: its operating budget (revenue and spending summaries), and discussions
-- on Worcester's own matters, such as a capital project (target id worcester-{slug}).

alter table public.discussions drop constraint discussions_jurisdiction_check;
alter table public.discussions add constraint discussions_jurisdiction_check
  check (jurisdiction in ('federal', 'ma', 'boston', 'worcester'));
-- A council district narrows a city discussion (Boston or Worcester).
alter table public.discussions drop constraint discussions_check1;
alter table public.discussions add constraint discussions_district_check
  check (district is null or jurisdiction in ('boston', 'worcester'));

-- The operating budget's revenue and spending summaries, line by line, as printed:
-- amounts[] follow the document's columns (e.g. FY25 actuals, FY26 budget, FY27 budget).
create table public.local_operating_documents (
  city text not null,
  fiscal_year smallint not null,
  stage text not null check (stage in ('proposed', 'adopted')),
  title text not null,
  source_url text not null,
  columns text[] not null,
  loaded_at timestamptz not null default now(),
  primary key (city, fiscal_year)
);

create table public.local_operating_lines (
  city text not null,
  fiscal_year smallint not null,
  kind text not null check (kind in ('revenue', 'spending')),
  seq smallint not null,
  grp text not null,
  label text not null,
  amounts numeric[] not null,
  primary key (city, fiscal_year, kind, seq)
);

alter table public.local_operating_documents enable row level security;
alter table public.local_operating_lines enable row level security;
create policy "Public read" on public.local_operating_documents for select to anon, authenticated using (true);
create policy "Public read" on public.local_operating_lines for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.local_operating_documents, public.local_operating_lines
  from anon, authenticated;
