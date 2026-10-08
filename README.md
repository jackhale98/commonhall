# Civic Tracker

A free, open-source site for following Congress and state legislatures: browse
federal and state bills, legislators and roll-call votes; find your
representatives from your address; sign in by email to follow bills and
legislators and see their activity in one feed.

"Civic Tracker" is a working name. The whole stack runs on free tiers and can be
forked and deployed by anyone with two API keys (Congress.gov and Open States).

## How it works

```
Congress.gov · senate.gov · congress-legislators · Open States · Census Geocoder
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
- **Pages** for current-Congress bills and members are prerendered at build time;
  each page then loads its live fields (status, latest action, votes) from
  Supabase, so updates appear without a rebuild. Newer bills, older Congresses
  and votes use client-rendered routes (`/bill/?id=…`, `/member/?id=…`,
  `/vote/?id=…`); a 404 page forwards canonical URLs to them.
- **Accounts** use Supabase Auth email magic links. Follows, feed and saved
  address are protected by row-level security.

| Job | Schedule | What it does |
| --- | --- | --- |
| `sync-federal` | every 10 min | New House/Senate roll calls, then bills changed since the cursor; writes feed events |
| `sync-members` | daily | Members from Congress.gov + congress-legislators |
| `sync-state` | nightly (several short runs) | Open States bills (current session) and, weekly, legislators |
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
| `supabase/seed.sql` | Real sample data for local development (no key needed) |
| `packages/congress-client/` | Typed clients for every upstream source, with recorded fixtures |
| `packages/sync/` | Sync logic shared by the Edge Functions and scripts |
| `scripts/` | Backfill, seed generation, acceptance checks |
| `.github/workflows/` | CI, site deploy, nightly rebuild, Supabase deploy, backfill |

## Local development

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm install`,
`npm run db:start`, `npm run db:reset`, copy `.env.example` to `site/.env` with the
local anon key, then `npm run dev`.

## Deploy your own

You need: a GitHub account, a free [Supabase](https://supabase.com) project, a
[Congress.gov API key](https://api.congress.gov/sign-up/), an
[Open States API key](https://open.pluralpolicy.com/accounts/profile/), and
(recommended) a free SMTP provider such as Resend for sign-in emails.

1. **Fork** this repository.
2. **Create a Supabase project.** Note its project ref, database password, and
   API keys (Project Settings → API).
3. **Repository secrets** (Settings → Secrets and variables → Actions → Secrets):

   | Secret | Used by |
   | --- | --- |
   | `SUPABASE_ACCESS_TOKEN` | Supabase deploy workflow ([create one](https://supabase.com/dashboard/account/tokens)) |
   | `SUPABASE_PROJECT_REF` | Supabase deploy workflow |
   | `SUPABASE_DB_PASSWORD` | Supabase deploy workflow |
   | `SUPABASE_DB_URL` | Backfill. Use the **session pooler** connection string (IPv4) from Connect → Session pooler |
   | `CONGRESS_API_KEY` | Backfill |

4. **Repository variables** (same page → Variables). These are public by design;
   the anon key is safe in the browser only because RLS is on for every table.

   | Variable | Value |
   | --- | --- |
   | `PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `PUBLIC_SUPABASE_ANON_KEY` | the publishable (anon) key |
   | `PUBLIC_SITE_NAME` | optional, defaults to "Civic Tracker" |

5. **Deploy the database and functions:** run the "Deploy Supabase" workflow (or
   push to `main`). It applies `supabase/migrations` and deploys every function.
6. **Function secrets** (Supabase dashboard → Edge Functions → Secrets, or
   `supabase secrets set`): `CONGRESS_API_KEY`, `OPENSTATES_API_KEY`,
   `SYNC_SECRET` (any long random string), and `SITE_ORIGINS`
   (e.g. `https://<user>.github.io`) to restrict CORS. Optional tuning:
   `SYNC_FEDERAL_RUN_CAP`, `SYNC_TIME_LIMIT_MS`, `OPENSTATES_DAILY_BUDGET`,
   `OPENSTATES_MIN_INTERVAL_MS`.
7. **Turn on the schedules** by storing two values in Vault (SQL editor):

   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<the same SYNC_SECRET>', 'sync_secret');
   ```

   Until both exist, the cron jobs do nothing.
8. **Auth settings** (Authentication → URL Configuration): set the Site URL to
   your Pages URL and add `https://<user>.github.io/<repo>/account/` to the
   redirect URLs. Under Emails, configure custom SMTP (the built-in sender is
   heavily rate-limited) and paste `supabase/templates/magic_link.html` into the
   magic-link template.
9. **GitHub Pages** (Settings → Pages): source "GitHub Actions". For a custom
   domain, configure it there; the build picks up the base path automatically.
10. **Backfill:** run the "Backfill" workflow. It loads members, every bill and
    every roll call of the current Congress, pausing at the hourly API limit and
    re-dispatching itself until done (roughly a day). When it finishes, the
    10-minute sync takes over. State data fills in over the following nights.
11. **Rebuild the site** ("Deploy site" workflow, or wait for the nightly
    rebuild) so bill and member pages are prerendered.

### Checking a deployment

```sh
SUPABASE_DB_URL=… npm run verify:votes        # stored roll-call totals vs the House Clerk and senate.gov
SUPABASE_DB_URL=… OPENSTATES_API_KEY=… npm run verify:reps   # 11 addresses in 10 states + DC
```

`sync_state` shows each job's cursor, last success, last error and requests
used; a weekly job records the database size there and fails loudly above
400 MB (the free tier allows 500 MB).

## License

[MIT](LICENSE). Congress.gov, senate.gov and congress-legislators data are in the
public domain; Open States data is CC0.
