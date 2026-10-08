# Civic Tracker

A free, open-source site for following Congress, state legislatures and the
Boston City Council: browse federal and state bills, council ordinances and
orders, legislators and roll-call votes; find your representatives (down to your
Boston council district) from your address; sign in by email to follow bills,
matters and legislators and see their activity in one feed; and take part in
moderated public discussions powered by Pol.is.

Massachusetts and Boston are first-class: Massachusetts syncs first and its
advancing bills get their own pages, and Boston has council pages, district
lookups and local discussions.

"Civic Tracker" is a working name. The whole stack runs on free tiers and can be
forked and deployed by anyone with two API keys (Congress.gov and Open States).

## How it works

```
Congress.gov · senate.gov · congress-legislators · Open States · Census Geocoder · Boston Legistar
                                  │
         Supabase Edge Functions (pg_cron: every 10 min / daily / nightly)
         + a one-off backfill script in GitHub Actions
                                  │  API keys live only here
                                  ▼
                       Supabase Postgres (RLS on every table)
                         │                          │
        GitHub Actions build (nightly)        Browser (publishable/anon key)
                         │                          │
                 Static Astro site on GitHub Pages ◄┘ live fields, follows, feed
```

- **Upstream APIs** are called only by the sync jobs and two small public
  functions (archive lookups, Find my reps), each with an hourly cap.
- **Pages** are prerendered at build time for members, councilors, discussions and
  *notable* items only: bills past committee, advancing Massachusetts bills, and
  anything followed or discussed (decided by `*_prerender` views; see
  docs/decisions.md #27). Pages load their live fields from Supabase, so updates
  appear without a rebuild. Everything else uses client-rendered routes
  (`/bill/?id=…`, `/state-bill/?…`, `/boston/matter/?id=…`, `/discussion/?id=…`,
  `/member/?id=…`, `/vote/?id=…`); the 404 page forwards clean URLs to them and
  they forward back once an item has a page (`/prerendered.json`).
- **Discussions** embed hosted Pol.is conversations. Pol.is gets a random
  per-user id and nothing else about the user (docs/discussions.md).
- **Accounts** use Supabase Auth email magic links. Follows, feed and saved
  address are protected by row-level security.

| Job | Schedule | What it does |
| --- | --- | --- |
| `sync-federal` | every 10 min | New House/Senate roll calls, then bills changed since the cursor; writes feed events |
| `sync-members` | daily | Members from Congress.gov + congress-legislators |
| `sync-state` | nightly (several short runs) | Open States bills (current session, Massachusetts first) and, weekly, legislators |
| `sync-boston` | nightly | Boston City Council matters, sponsors, actions, meetings and councilors from Legistar (no key) |
| `fetch-on-demand` | per request | Bills/members not in the database, cached 30 days |
| `geocode` | per request | Find my reps |
| `delete-account` | per request | Deletes the signed-in user |
| `backfill` (Actions) | manual | Loads the whole current Congress (~100k requests, about a day) |

[`docs/decisions.md`](docs/decisions.md) records where the implementation departs
from the original build plan and why (scheduling limits, API quirks, the Census
redistricting trap, and so on).

## Repository layout

| Path | What |
| --- | --- |
| `site/` | Astro app (static output, Preact islands) |
| `supabase/migrations/` | Database schema, one SQL file per change |
| `supabase/functions/` | Edge Functions (Deno) |
| `supabase/tests/` | Database tests: RLS, sync jobs, feed, votes, states |
| `supabase/seed.sql`, `seed-local.sql` | Real sample data for local development (no key needed): federal, Boston, Massachusetts legislators, two example discussions |
| `supabase/data/` | Boston council seat map (Legistar has no seats) |
| `docs/` | Decisions log and the discussions guide |
| `packages/congress-client/` | Typed clients for every upstream source, with recorded fixtures |
| `packages/sync/` | Sync logic shared by the Edge Functions and scripts |
| `scripts/` | Backfill, seed generation, acceptance checks |
| `.github/workflows/` | CI, site deploy, nightly rebuild, Supabase deploy, backfill |

## Local development

Needs Node 22 and Docker. See [CONTRIBUTING.md](CONTRIBUTING.md) for more.

```sh
npm install
npm run db:start            # local Supabase in Docker (Postgres, Auth, REST, mail catcher)
npm run db:reset            # apply migrations and load supabase/seed.sql + seed-local.sql
npx supabase status         # prints the local API URL, anon key and service_role key
cp .env.example site/.env   # then set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY from `status`
npm run dev                 # http://localhost:4321
```

Sign-in emails go to the local mail catcher at http://127.0.0.1:54324. No API
keys are needed: the seed holds real sample data. To run a sync job against the
local database:

```sh
export SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
npm run load-districts                     # Boston council districts (full detail)
npm run job -- boston --since 2026-07-01   # Boston City Council, no key needed
OPENSTATES_API_KEY=… npm run job -- state  # state bills and legislators
```

## Demo mode

Until a Supabase project is configured (no `PUBLIC_SUPABASE_URL` repository
variable), the Pages deploy builds a **demo** from `site/src/data/demo.json`: the
seed's 539 members, 50 real bills, 6 real roll calls, recent Boston City Council
matters and councilors, Massachusetts legislators and two example discussions.
Bill, member, state, Boston and vote pages work and search filters the sample in
the browser; accounts, follows, the feed, Find my reps and the discussion embed
are switched off, and a banner says so. To try
it on your fork, enable Pages (Settings → Pages → Source: GitHub Actions) and run
the "Deploy site" workflow. Setting the Supabase variables switches the next
build to the real site. Regenerate the snapshot with `npm run db:reset` then
`npm run demo:export`.

## Deploy your own

Everything runs on free tiers. You need:

- a GitHub account (the site is served by GitHub Pages);
- a free [Supabase](https://supabase.com) project (database, sign-in, scheduled jobs);
- a free [Congress.gov API key](https://api.congress.gov/sign-up/) and a free
  [Open States API key](https://open.pluralpolicy.com/accounts/profile/);
- recommended: a free SMTP provider (for example Resend or Brevo) for sign-in emails;
- optional: a [Pol.is](https://pol.is) account for discussions.

Until Supabase is connected, the Pages deploy builds the demo (see above), so you
can do the steps below in any order and the site keeps working.

### 1. Fork and turn on Pages

1. Fork this repository.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Actions → "Deploy site" → Run workflow. You now have the demo at
   `https://<user>.github.io/<repo>/`.

### 2. Create the Supabase project

1. In the [Supabase dashboard](https://supabase.com/dashboard), **New project**.
   Pick the region closest to most of your visitors and save the **database
   password** in a password manager; you need it below.
2. When the project is ready, collect four values:

   | Value | Where | Secret? |
   | --- | --- | --- |
   | Project ref | the `<ref>` in `https://supabase.com/dashboard/project/<ref>` | no |
   | Project URL | Project Settings → API (Data API) → URL, `https://<ref>.supabase.co` | no |
   | Publishable (anon) key | Project Settings → API Keys → `anon` / publishable | no: it is shipped to browsers, and row-level security protects the data |
   | Secret (service_role) key | Project Settings → API Keys → `service_role` / secret | **yes**: never put it in the site, a `PUBLIC_` variable or a commit |

3. Create a personal access token for the deploy workflow at
   [Account → Access Tokens](https://supabase.com/dashboard/account/tokens).
4. Copy the **session pooler** connection string from the project's **Connect**
   button → Session pooler. It works over IPv4, which GitHub Actions needs:
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.

### 3. GitHub secrets and variables

Settings → Secrets and variables → Actions.

**Secrets** (private):

| Secret | Value | Used by |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | the personal access token | "Deploy Supabase" workflow |
| `SUPABASE_PROJECT_REF` | the project ref | "Deploy Supabase" workflow |
| `SUPABASE_DB_PASSWORD` | the database password | "Deploy Supabase" workflow |
| `SUPABASE_DB_URL` | the session pooler connection string | Backfill workflow |
| `CONGRESS_API_KEY` | your Congress.gov key | Backfill workflow |

**Variables** (public by design; they end up in the browser):

| Variable | Value |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` (setting this switches the site from demo to live) |
| `PUBLIC_SUPABASE_ANON_KEY` | the publishable (anon) key |
| `PUBLIC_SITE_NAME` | optional, defaults to "Civic Tracker" |
| `PUBLIC_POLIS_SITE_ID` | optional, your Pol.is site id; turns on discussions (docs/discussions.md) |

### 4. Create the database and deploy the functions

Run Actions → **"Deploy Supabase"** → Run workflow (it also runs on every push to
`main` that touches `supabase/` or `packages/`). It links the project, applies
every file in `supabase/migrations` (`supabase db push`) and deploys every Edge
Function. The migrations enable the extensions they need (`pg_cron`, `pg_net`,
`postgis`), create all tables with row-level security, and register the
schedules. They do **not** load the sample seed data.

To do the same from your machine instead:

```sh
npx supabase login
npx supabase link --project-ref <ref>      # asks for the database password
npx supabase db push                       # apply migrations
npx supabase functions deploy              # deploy every function
```

Check it worked: Dashboard → Table Editor lists `bills`, `members`,
`local_matters`, `discussions` and the rest; Edge Functions lists `sync-federal`,
`sync-members`, `sync-state`, `sync-boston`, `fetch-on-demand`, `geocode` and
`delete-account`.

### 5. Function secrets

Edge Functions read their keys from Supabase secrets, never from the site.
Dashboard → Edge Functions → Secrets, or:

```sh
npx supabase secrets set \
  CONGRESS_API_KEY=... \
  OPENSTATES_API_KEY=... \
  SYNC_SECRET="$(openssl rand -hex 32)" \
  SITE_ORIGINS=https://<user>.github.io
```

- `SYNC_SECRET`: any long random string. Scheduled jobs send it in the
  `x-sync-secret` header, so nobody else can trigger a sync. Keep a copy for step 6.
- `SITE_ORIGINS`: comma-separated origins allowed to call the public functions
  (CORS). Add your custom domain if you use one.
- Optional tuning: `SYNC_FEDERAL_RUN_CAP`, `SYNC_TIME_LIMIT_MS`,
  `OPENSTATES_DAILY_BUDGET`, `OPENSTATES_MIN_INTERVAL_MS`.

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` are provided to
functions automatically; do not set them.

### 6. Turn on the schedules

`pg_cron` calls the sync functions through `pg_net`, reading the project URL and
the shared secret from Vault. In the SQL editor:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<the same SYNC_SECRET>', 'sync_secret');
```

Until both exist the cron jobs run but do nothing. Check them:

```sql
select jobname, schedule from cron.job order by jobname;                 -- the schedules
select status, return_message, start_time from cron.job_run_details
 order by start_time desc limit 10;                                      -- recent runs
select id, status_code, left(content, 200) from net._http_response
 order by id desc limit 10;                                              -- function responses
select job, last_success_at, last_error, cursor from public.sync_state;  -- each job's progress
```

A `401` in `net._http_response` means the Vault `sync_secret` and the function
`SYNC_SECRET` differ. To change one, run
`select vault.update_secret((select id from vault.secrets where name = 'sync_secret'), '<new>');`.

### 7. Sign-in (Auth)

1. Authentication → URL Configuration: set **Site URL** to
   `https://<user>.github.io/<repo>/` and add
   `https://<user>.github.io/<repo>/account/` to **Redirect URLs** (plus your custom
   domain's `/account/` if you have one).
2. Authentication → Emails → SMTP Settings: enable custom SMTP with your provider.
   Supabase's built-in sender allows only a few emails an hour and is meant for
   testing.
3. Authentication → Emails → Templates → Magic Link: paste
   `supabase/templates/magic_link.html`.
4. Authentication → Sign In / Providers: keep **Email** on; password sign-in and
   other providers are not used.

### 8. Load data

1. **Federal backfill:** Actions → "Backfill" → Run workflow. It loads members,
   every bill and every roll call of the current Congress, pausing at the hourly
   API limit and re-dispatching itself until done (roughly a day). The 10-minute
   `sync-federal` job then keeps it current.
2. **Boston council districts** (once, and again after redistricting):
   `SUPABASE_DB_URL='<session pooler string>' npm run load-districts`. Council
   data then arrives with the nightly `sync-boston` (no key needed).
3. **State data** fills in over the following nights through `sync-state`,
   Massachusetts first.

### 9. Rebuild the site

Actions → "Deploy site" → Run workflow (it also runs nightly). With
`PUBLIC_SUPABASE_URL` set, the build reads the database instead of the demo
snapshot and prerenders members and notable bills. The deploy fails if the site
exceeds 300 MB.

### 10. Optional: discussions and maintainers

Follow [docs/discussions.md](docs/discussions.md) to connect Pol.is, then make
yourself a maintainer in the SQL editor:

```sql
insert into public.admins (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.org';
```

### Free-tier notes

- The free database allows 500 MB. A weekly job records the size in `sync_state`
  and fails loudly above 400 MB.
- Supabase pauses free projects after about a week without activity. The nightly
  site build and the sync jobs normally keep it active; if it is paused, restore it
  from the dashboard and rerun "Deploy site".
- Edge Functions on the free plan allow 500,000 invocations a month; the
  schedules use well under 10,000.

### Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| The site still shows the demo banner | `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` are not set as **variables** (not secrets), or "Deploy site" has not run since |
| "Deploy Supabase" says it skipped | One of its three secrets is missing |
| `supabase db push` fails to connect | Wrong `SUPABASE_DB_PASSWORD`; reset it under Project Settings → Database |
| Backfill cannot connect | `SUPABASE_DB_URL` is the direct (IPv6) string; use the session pooler string |
| Nothing syncs | Vault secrets missing or `SYNC_SECRET` mismatch (step 6 queries) |
| Sign-in link opens the wrong page or errors | The `/account/` URL is not in Redirect URLs |
| Sign-in emails never arrive | Built-in email rate limit; configure SMTP |
| Find my reps fails with a CORS error | `SITE_ORIGINS` does not include the site's origin |
| Bill pages are missing for most bills | Expected: only notable bills are prerendered; others load at `/bill/?id=…` |

### Checking a deployment

```sh
SUPABASE_DB_URL=… npm run verify:votes        # stored roll-call totals vs the House Clerk and senate.gov
SUPABASE_DB_URL=… OPENSTATES_API_KEY=… npm run verify:reps   # 11 addresses in 10 states + DC, 10 Boston addresses
SUPABASE_SERVICE_ROLE_KEY=… npm run check:polis   # nothing about the user but a random id reaches pol.is
```

`sync_state` shows each job's cursor, last success, last error and requests
used; a weekly job records the database size there and fails loudly above
400 MB (the free tier allows 500 MB).

## License

[MIT](LICENSE). Congress.gov, senate.gov and congress-legislators data are in the
public domain; Open States data is CC0; Boston data is published by the City of
Boston (Legistar, Analyze Boston).
