# Deployment and operations

How the production site is set up and run: GitHub Pages for the website, Supabase
for the database, sign-in and scheduled jobs. Follow the steps in order the first
time; the later sections cover day-to-day checks and troubleshooting. The same
steps work for anyone running their own copy.

Every setting is also listed in one table in [configuration.md](configuration.md).

## Contents

1. [Turn on Pages](#1-turn-on-pages)
2. [Create the Supabase project](#2-create-the-supabase-project)
3. [GitHub settings, secrets and variables](#3-github-settings-secrets-and-variables)
4. [Create the database and deploy the functions](#4-create-the-database-and-deploy-the-functions)
5. [Function secrets](#5-function-secrets)
6. [Turn on the schedules](#6-turn-on-the-schedules)
7. [Sign-in (Auth)](#7-sign-in-auth)
8. [Load data](#8-load-data)
9. [Rebuild the site](#9-rebuild-the-site)
10. [Optional: discussions and maintainers](#10-optional-discussions-and-maintainers)
- [Free-tier notes](#free-tier-notes)
- [Troubleshooting](#troubleshooting)
- [Checking a deployment](#checking-a-deployment)

## What you need

Everything runs on free tiers:

- the GitHub repository (the site is served by GitHub Pages);
- a free [Supabase](https://supabase.com) project (database, sign-in, scheduled jobs);
- a free [Congress.gov API key](https://api.congress.gov/sign-up/) and a free
  [Open States API key](https://open.pluralpolicy.com/accounts/profile/);
- recommended: a free SMTP provider (for example Resend or Brevo) for sign-in emails;
- optional: a [Pol.is](https://pol.is) account for discussions.

Until Supabase is connected (no `PUBLIC_SUPABASE_URL` variable), the Pages deploy
builds a **demo** from `site/src/data/demo.json`, a snapshot of the sample data:
539 members, 50 real bills, 6 roll-call votes, recent Boston council matters,
Massachusetts legislators and two example discussions. Pages, charts and search
work; accounts, following, the feed and Find my reps are off, and a banner says
so. You can do the steps below in any order and the site keeps working; setting
the Supabase variables switches the next build to the live site.

## 1. Turn on Pages

1. If you are setting up your own copy, fork this repository first.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Actions → "Deploy site" → Run workflow. You now have the demo at
   `https://<user>.github.io/<repo>/`.

## 2. Create the Supabase project

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

3. Create an access token for the deploy workflow at
   [Account → Access Tokens](https://supabase.com/dashboard/account/tokens).
   Use a **scoped token** limited to this one project, with only these
   permissions:

   | Permission | Access | Why |
   | --- | --- | --- |
   | Project Settings | Read | `supabase link` reads the project's details |
   | API Keys | Read | `supabase link` |
   | API Key Secrets | Read | `supabase link` |
   | Edge Functions | Read-write | `supabase functions deploy` |

   Applying migrations (`supabase db push`) connects straight to Postgres through
   the session pooler (`SUPABASE_DB_URL`, step 3), so it needs no token
   permission. GitHub's runners have no IPv6, so the pooler's IPv4 address is
   required.
   The workflow never sets function secrets; if you also want to run
   `supabase secrets set` from your own machine with this token, add **Edge
   Function Secrets: Read-write**. A classic (legacy) token also works, but it can
   act on every project and organization in your account, so avoid it for CI. If
   a step fails with a 403, the error names the missing permission. Store the
   token only as the `SUPABASE_ACCESS_TOKEN` GitHub secret.
4. Copy the **session pooler** connection string from the project's **Connect**
   button → Session pooler. It works over IPv4, which GitHub Actions needs:
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.

## 3. GitHub settings, secrets and variables

Every value GitHub needs, in one place. A full reference of every setting
(GitHub, Supabase and local) is in [configuration.md](configuration.md).

**a. Turn on Actions (forks only).** GitHub disables workflows on forks. Open the
**Actions** tab and select "I understand my workflows, go ahead and enable them".
Scheduled workflows (the nightly rebuild) also need enabling there if GitHub
shows a banner.

**b. Workflow permissions.** Settings → Actions → General → Workflow permissions:
choose **Read and write permissions**. The Backfill workflow re-dispatches itself
when it runs out of time, which needs `actions: write`; the workflows ask only for
the permissions they use.

**c. Pages.** Settings → Pages → Build and deployment → Source: **GitHub Actions**
(step 1). For a custom domain, set it here and tick "Enforce HTTPS"; the build
reads the URL and base path from Pages automatically, so nothing else changes.
The `github-pages` environment that GitHub creates allows deploys from the default
branch only; leave it that way.

**d. Secrets** (Settings → Secrets and variables → Actions → **Secrets** tab →
New repository secret). Repository secrets, not environment secrets:

| Secret | Value | Where to find it | Used by |
| --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | a Supabase **scoped** access token for this project (permissions in step 2.3) | [Account → Access Tokens](https://supabase.com/dashboard/account/tokens) → Generate new token | Deploy Supabase |
| `SUPABASE_PROJECT_REF` | the project ref, e.g. `abcdefghijklmnopqrst` | the dashboard URL `…/project/<ref>`, or Project Settings → General | Deploy Supabase |
| `SUPABASE_DB_PASSWORD` | the database password | chosen when creating the project; reset under Project Settings → Database | Deploy Supabase |
| `SUPABASE_DB_URL` | the **session pooler** connection string, password filled in (URL-encode any special characters in the password) | Connect (top of the dashboard) → Session pooler | Deploy Supabase (migrations), Backfill |
| `CONGRESS_API_KEY` | your Congress.gov key | the email from [api.congress.gov/sign-up](https://api.congress.gov/sign-up/) | Backfill |

**e. Variables** (same page → **Variables** tab → New repository variable). These
are public by design: they are compiled into the site and visible to anyone.
Repository variables, not environment variables (the build job does not run in
an environment):

| Variable | Value | Required? |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Yes for the live site. Empty = demo build |
| `PUBLIC_SUPABASE_ANON_KEY` | the publishable (anon) key from Project Settings → API Keys | Yes for the live site |
| `PUBLIC_SITE_NAME` | the name in the header and page titles | No (default "Civic Tracker") |
| `PUBLIC_POLIS_SITE_ID` | your Pol.is site id (`polis_…`) | No; turns on discussions (in the demo, the examples are an open preview without sign-in) |

**Never put these in GitHub:** the Supabase `service_role`/secret key, the Open
States key and `SYNC_SECRET`. They live only in Supabase function secrets (step 5).
Nothing that starts with `PUBLIC_` may ever hold a secret.

**f. What runs when**

| Workflow | Runs | Needs |
| --- | --- | --- |
| CI | every pull request and push to `main` | nothing (uses the seed in a local Supabase) |
| Deploy site | push to `main`, manually, and from Nightly rebuild | the variables (none = demo) |
| Nightly rebuild | 09:17 UTC daily | same as Deploy site |
| Deploy Supabase | push to `main` touching `supabase/` or `packages/`, and manually | the three `SUPABASE_*` deploy secrets (skips cleanly without them), plus `SUPABASE_DB_URL` for migrations |
| Backfill | manually only | `SUPABASE_DB_URL`, `CONGRESS_API_KEY`, write permission (b) |

GitHub turns off scheduled workflows in a repository with no activity for 60 days.
If the nightly rebuild stops, re-enable it from the Actions tab.

## 4. Create the database and deploy the functions

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

## 5. Function secrets

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

## 6. Turn on the schedules

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

## 7. Sign-in (Auth)

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

## 8. Load data

1. **Federal backfill:** Actions → "Backfill" → Run workflow. It loads members,
   every bill and every roll call of the current Congress, pausing at the hourly
   API limit and re-dispatching itself until done (roughly a day). The 10-minute
   `sync-federal` job then keeps it current.
2. **Boston council districts** (once, and again after redistricting):
   `SUPABASE_DB_URL='<session pooler string>' npm run load-districts`. Council
   data then arrives with the nightly `sync-boston` (no key needed).
3. **State data** fills in over the following nights through `sync-state`,
   Massachusetts first.

## 9. Rebuild the site

Actions → "Deploy site" → Run workflow (it also runs nightly). With
`PUBLIC_SUPABASE_URL` set, the build reads the database instead of the demo
snapshot and prerenders members and notable bills. The deploy fails if the site
exceeds 300 MB.

## 10. Optional: discussions and maintainers

Follow [discussions.md](discussions.md) to connect Pol.is, then make
yourself a maintainer in the SQL editor:

```sql
insert into public.admins (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.org';
```

## Free-tier notes

- The free database allows 500 MB. A weekly job records the size in `sync_state`
  and fails loudly above 400 MB.
- Supabase pauses free projects after about a week without activity. The nightly
  site build and the sync jobs normally keep it active; if it is paused, restore it
  from the dashboard and rerun "Deploy site".
- Edge Functions on the free plan allow 500,000 invocations a month; the
  schedules use well under 10,000.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| The site still shows the demo banner | `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` are not set as **variables** (not secrets), or "Deploy site" has not run since |
| "Deploy Supabase" says it skipped | One of its three secrets is missing |
| `supabase db push` fails to connect | Wrong `SUPABASE_DB_PASSWORD`; reset it under Project Settings → Database |
| "IPv6 is not supported on your current network" in Deploy Supabase | `SUPABASE_DB_URL` is missing or is the direct (IPv6) string; set it to the session pooler string |
| Backfill cannot connect | `SUPABASE_DB_URL` is the direct (IPv6) string; use the session pooler string |
| Nothing syncs | Vault secrets missing or `SYNC_SECRET` mismatch (step 6 queries) |
| Sign-in link opens the wrong page or errors | The `/account/` URL is not in Redirect URLs |
| Sign-in emails never arrive | Built-in email rate limit; configure SMTP |
| Find my reps fails with a CORS error | `SITE_ORIGINS` does not include the site's origin |
| Bill pages are missing for most bills | Expected: only notable bills are prerendered; others load at `/bill/?id=…` |

## Checking a deployment

```sh
SUPABASE_DB_URL=… npm run verify:votes        # stored roll-call totals vs the House Clerk and senate.gov
SUPABASE_DB_URL=… OPENSTATES_API_KEY=… npm run verify:reps   # 11 addresses in 10 states + DC, 10 Boston addresses
SUPABASE_SERVICE_ROLE_KEY=… npm run check:polis   # nothing about the user but a random id reaches pol.is
```

`sync_state` shows each job's cursor, last success, last error and requests
used; a weekly job records the database size there and fails loudly above
400 MB (the free tier allows 500 MB).
