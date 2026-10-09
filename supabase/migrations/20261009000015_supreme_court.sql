-- Supreme Court decisions (CourtListener opinion clusters), kept current by sync-scotus.

create table public.scotus_cases (
  cluster_id bigint primary key,
  docket_id bigint,
  case_name text not null,
  case_name_full text,
  docket_number text,
  date_filed date not null,
  date_argued date,
  /** October Term year, e.g. 2025 for decisions from October 2025 to September 2026. */
  term smallint not null,
  citations text[] not null default '{}',
  url text not null,
  judges text,
  /** CourtListener opinion type slugs: lead-opinion, combined-opinion, concurrence-opinion, dissent, … */
  opinion_types text[] not null default '{}',
  /** Separately listed dissents and concurrences; 0 can mean "in a combined document". */
  dissents smallint not null default 0,
  concurrences smallint not null default 0,
  per_curiam boolean not null default false,
  syllabus text,
  created_at timestamptz not null default now()
);

comment on table public.scotus_cases is 'Supreme Court decisions from CourtListener, the last five terms.';
create index scotus_cases_date_idx on public.scotus_cases (date_filed desc);
create index scotus_cases_term_idx on public.scotus_cases (term);

alter table public.scotus_cases enable row level security;
create policy "Public read" on public.scotus_cases for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.scotus_cases from anon, authenticated;

-- Hourly: one request when nothing new was decided.
select cron.schedule('sync-scotus', '20 * * * *', $$select private.invoke_sync('sync-scotus')$$);
