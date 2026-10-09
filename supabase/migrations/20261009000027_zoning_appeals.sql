-- Boston Zoning Board of Appeal cases (Analyze Boston, "zoning-board-of-appeal-tracker"),
-- refreshed daily by sync-boston-zba: every open appeal and every appeal heard in the
-- last year. Applicants' names are not stored. Hearings are public; residents can
-- testify, which is why upcoming ones lead the Neighborhoods page.

create table public.zba_appeals (
  boa_apno text primary key,
  parent_apno text,
  address text,
  neighborhood text,
  zip text,
  ward text,
  zoning_district text,
  appeal_type text,
  status text,
  description text,
  received_date date,
  hearing_date date,
  /** Approved, Approved with provisos, Denied, Withdrawn, Void (normalised from the city's codes). */
  decision text,
  final_decision_date date,
  closed_date date,
  deferrals smallint not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.zba_appeals is 'Boston Zoning Board of Appeal cases: open or heard in the last year (no applicant names).';
create index zba_appeals_hearing_idx on public.zba_appeals (hearing_date);
create index zba_appeals_neighborhood_idx on public.zba_appeals (neighborhood);

alter table public.zba_appeals enable row level security;
create policy "Public read" on public.zba_appeals for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.zba_appeals from anon, authenticated;

-- Daily, 10:23 UTC (about 6 a.m. in Boston), after the city's nightly refresh.
select cron.schedule('sync-boston-zba', '23 10 * * *', $$select private.invoke_sync('sync-boston-zba')$$);
