# Configuration reference

Every setting the project reads, grouped by where it is set. The README's
"Deploy your own" section walks through them in order.

## GitHub repository secrets

Settings → Secrets and variables → Actions → Secrets. Private; workflows only.

| Name | Required | Used by | Notes |
| --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | for Deploy Supabase | `supabase-deploy.yml` | Scoped access token for this project only: Project Settings (Read), API Keys (Read), API Key Secrets (Read), Edge Functions (Read-write) |
| `SUPABASE_PROJECT_REF` | for Deploy Supabase | `supabase-deploy.yml` | The 20-character project id |
| `SUPABASE_DB_PASSWORD` | for Deploy Supabase | `supabase-deploy.yml` | Database password; used by `supabase link` and `db push` |
| `SUPABASE_DB_URL` | for Backfill | `backfill.yml` | Session pooler string (IPv4), port 5432 |
| `CONGRESS_API_KEY` | for Backfill | `backfill.yml` | Congress.gov key |

Deploy Supabase skips itself if any of its three secrets is missing. The token is
used by `supabase link` and `supabase functions deploy`; `supabase db push` uses
the database password instead. Add Edge Function Secrets (Read-write) only if you
run `supabase secrets set` with the same token. A classic (legacy) token works but
has full access to every project in the account.

## GitHub repository variables

Settings → Secrets and variables → Actions → Variables. **Public**: compiled into
the site.

| Name | Required | Used by | Notes |
| --- | --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | for the live site | `deploy.yml` (build) | Empty: the site builds in demo mode |
| `PUBLIC_SUPABASE_ANON_KEY` | for the live site | `deploy.yml` (build) | Publishable (anon) key; safe only because RLS is on everywhere |
| `PUBLIC_SITE_NAME` | no | `deploy.yml` (build) | Default "Civic Tracker" |
| `PUBLIC_POLIS_SITE_ID` | no | `deploy.yml` (build) | Turns on the discussion embed |

Set automatically by the deploy workflow from GitHub Pages (do not set them):
`SITE_URL` (origin) and `BASE_PATH` (`/<repo>/`, or `/` with a custom domain), and
`PUBLIC_DEMO` (`true` when `PUBLIC_SUPABASE_URL` is empty).

## GitHub settings

| Setting | Value | Why |
| --- | --- | --- |
| Actions tab (forks) | enable workflows | Forks start with Actions off |
| Settings → Actions → General → Workflow permissions | Read and write | Backfill re-dispatches itself (`actions: write`) |
| Settings → Pages → Source | GitHub Actions | The deploy workflow publishes the site |
| Settings → Pages → Custom domain | optional | Base path adjusts automatically |

## Supabase Edge Function secrets

Dashboard → Edge Functions → Secrets, or `supabase secrets set NAME=value`.

| Name | Required | Used by | Default |
| --- | --- | --- | --- |
| `CONGRESS_API_KEY` | yes | `sync-federal`, `sync-members`, `fetch-on-demand` | |
| `OPENSTATES_API_KEY` | yes for state data | `sync-state`, `geocode` | |
| `SYNC_SECRET` | yes | every scheduled function | Must equal the Vault `sync_secret` |
| `SITE_ORIGINS` | recommended | public functions (CORS) | any origin |
| `SYNC_FEDERAL_RUN_CAP` | no | `sync-federal` | 580 requests per run |
| `SYNC_TIME_LIMIT_MS` | no | sync functions | 120000 |
| `OPENSTATES_DAILY_BUDGET` | no | `sync-state` | 450 requests per UTC day |
| `OPENSTATES_MIN_INTERVAL_MS` | no | `sync-state` | 1100 |

Provided by Supabase automatically: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`.

## Supabase Vault

SQL editor. Read by `private.invoke_sync()` when pg_cron fires.

| Name | Value |
| --- | --- |
| `project_url` | `https://<ref>.supabase.co` |
| `sync_secret` | the same value as the `SYNC_SECRET` function secret |

## Supabase dashboard settings

| Setting | Value |
| --- | --- |
| Authentication → URL Configuration → Site URL | `https://<user>.github.io/<repo>/` |
| Authentication → URL Configuration → Redirect URLs | `https://<user>.github.io/<repo>/account/` (and a custom domain's) |
| Authentication → Emails → SMTP Settings | your SMTP provider |
| Authentication → Emails → Templates → Magic Link | `supabase/templates/magic_link.html` |

## Local development and scripts

In `site/.env` (copy `.env.example`) or the shell.

| Name | Used by | Notes |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | site | From `npx supabase status` |
| `PUBLIC_DEMO` | site | `true` with no Supabase: build from `demo.json` |
| `PUBLIC_POLIS_SITE_ID` | site | Optional |
| `SITE_URL`, `BASE_PATH` | site build | Default `http://localhost:4321` and `/` |
| `SITE_MAX_BILL_PAGES` | site build | Cap prerendered bills for quick builds |
| `SUPABASE_DB_URL` | scripts (`backfill`, `job`, `load-districts`, `make-local-seed`, `demo:export`, `verify:*`) | Local: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `CONGRESS_API_KEY` | `backfill`, `verify:votes` | |
| `OPENSTATES_API_KEY` | `job -- state`, `verify:reps` | |
| `BACKFILL_CONGRESS`, `BACKFILL_MAX_HOURS` | `backfill` | Set by the Backfill workflow |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE`, `DISCUSSION` | `check:polis` | Local only |
| `TEST_DATABASE_URL` | database tests | Default: the local Supabase |
