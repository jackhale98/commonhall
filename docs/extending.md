# Adding a city, a state or a data source

The site is built so that coverage grows by adding settings and a sync, not page
code. This is the checklist for each kind of addition. Before adding a new data
source, check with the project owner (see CONTRIBUTING.md): sources must be free,
official or openly licensed, and need no key in the browser.

## A city

Pages are shared: every city gets the same Overview, Council, Committees,
Neighborhoods and Budget tabs, and a tab appears only when there is data behind it.

1. **Registry entry** in `site/src/lib/cities.ts` (`CITY_LIST`): key
   (`{state}-{slug}`, e.g. `ma-springfield`), name, council, districts, sources and
   cadences. The menu, the states page, search and the Data status page pick it up.
2. **Sync**, by what the city publishes:
   - **Legistar** (`{client}.legistar.com`): a `LegistarCity` (key, name, Legistar
     client, council body, legislative matter types, committees, docket label) and a
     seat map like `supabase/data/boston-council-seats.json`, then an Edge Function
     calling `syncLegistarCity(run, { client, seats, city })` (copy
     `supabase/functions/sync-boston/`). No new sync code.
   - **PrimeGov**, or a city website: follow `packages/sync/src/local/worcester.ts`.
     Keep the guards: refuse to replace good data with nothing (a minimum count),
     and fail when nothing is recognized.
   - **Open data (CKAN)** such as 311 or zoning: follow `local/boston-311.ts` and
     `local/zoning.ts`; tables are keyed by city.
3. **Schedule**: a migration with `cron.schedule(... private.invoke_sync('sync-x'))`,
   the function in `supabase/config.toml`, and a row in `private.job_schedule` (job
   name, label, how often it runs, where it runs) so the daily health check covers
   it. Datasets are checked per city without changes.
4. **Council districts** (for Find my reps): load the city's district shapes with
   the "Load council districts" workflow pattern (`scripts/load-districts.ts`).

## A state in more depth

Every state already has its delegation, legislators, committees and bills (Open
States). For more:

1. An entry in `site/src/lib/states.ts` (`STATE_FEATURES`): a featured card and menu
   entry, whether its bills can have discussions, and a link builder for bills on the
   legislature's own site.
2. More bill detail (actions, votes, abstracts): add the state to
   `FIRST_CLASS_STATES` in `packages/sync/src/state/sync-state.ts`. It uses more of
   the daily Open States budget.
3. Courts: add the court to `STATE_COURTS` in `packages/sync/src/state/courts.ts`
   and its name to `STATE_COURT_NAMES` in `site/src/lib/state-tabs.ts`.
   CourtListener's free tier is shared (`DAILY_SHARES` in `packages/sync/src/job.ts`).
4. Governor's orders: a loader like `scripts/load-ma-orders.ts` writing
   `state_executive_orders` with the state's code; the Governor tab appears when
   there are orders.

## Any new job or loader

- Run it inside `runJob` (scheduled functions) or `recordRun` (GitHub Actions
  loaders, `scripts/lib/record-run.ts`), so it has a lease, a last success and a
  last error.
- Use `HttpClient` from `@civic/congress-client` for requests: retries, backoff, a
  60-second timeout and keys kept out of errors.
- Add a `private.job_schedule` row. If it fills a new table, add the table's newest
  date to `private.data_freshness()` with a generous limit.
- Record fixtures from the real source and test the parser against them, including a
  page or response whose layout has changed (the guard should throw).
- Write down the reasoning in `docs/decisions.md`.
