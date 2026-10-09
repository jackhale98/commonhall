-- The executive branch: executive orders (Federal Register) and presidential
-- nominations to the Senate (Congress.gov), kept current by sync-executive.

create table public.executive_orders (
  document_number text primary key,
  eo_number integer,
  title text not null,
  president text,
  president_name text,
  signing_date date,
  publication_date date not null,
  citation text,
  html_url text not null,
  pdf_url text,
  abstract text,
  /** Federal Register disposition notes, e.g. "Revokes: EO 14148, January 20, 2025". */
  notes text,
  /** EO numbers named after "Revokes:" / "Revoked by:" in the notes. */
  revokes integer[] not null default '{}',
  revoked_by integer[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.executive_orders is 'Executive orders published in the Federal Register (1994 onward).';
create index executive_orders_number_idx on public.executive_orders (eo_number);
create index executive_orders_signing_idx on public.executive_orders (signing_date desc);
create index executive_orders_president_idx on public.executive_orders (president, signing_date desc);

create table public.nominations (
  /** {congress}-pn{number}[-{part}], e.g. 119-pn373 or 119-pn615-2. */
  id text primary key check (id ~ '^[0-9]+-pn[0-9]+(-[0-9]+)?$'),
  congress smallint not null,
  number integer not null,
  part smallint,
  citation text not null,
  description text,
  nominee text,
  position text,
  organization text,
  is_military boolean not null default false,
  received_date date,
  latest_action_date date,
  latest_action_text text,
  status text not null check (status in (
    'received', 'in_committee', 'reported', 'on_calendar', 'floor', 'confirmed', 'rejected', 'withdrawn', 'returned')),
  source_updated_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.nominations is 'Presidential nominations received by the Senate (Congress.gov), one row per nomination part.';
create index nominations_civilian_idx on public.nominations (congress, latest_action_date desc) where not is_military;
create index nominations_status_idx on public.nominations (status);

alter table public.votes add column nomination_id text;
comment on column public.votes.nomination_id is 'Senate votes on a nomination (no foreign key: the nomination may not be loaded yet).';
create index votes_nomination_idx on public.votes (nomination_id) where nomination_id is not null;

alter table public.executive_orders enable row level security;
alter table public.nominations enable row level security;
create policy "Public read" on public.executive_orders for select to anon, authenticated using (true);
create policy "Public read" on public.nominations for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.executive_orders, public.nominations from anon, authenticated;

-- Hourly: one or two requests per run after the first load.
select cron.schedule('sync-executive', '50 * * * *', $$select private.invoke_sync('sync-executive')$$);
