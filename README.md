# Civic Tracker

A free, open-source site for following Congress and state legislatures: browse
federal and state bills, legislators and roll-call votes; sign in by email to
follow bills and legislators and see their activity in one feed.

"Civic Tracker" is a working name. The whole stack runs on free tiers and can be
forked and deployed by anyone with two API keys.

## How it works

```
Congress.gov · senate.gov · congress-legislators · Open States · Census Geocoder
                                  │
             Supabase Edge Functions (pg_cron, hourly / nightly)
             + a one-off backfill script in GitHub Actions
                                  │  service-role key; API keys live only here
                                  ▼
                       Supabase Postgres (RLS on every table)
                         │                          │
        GitHub Actions build (nightly)        Browser (anon key)
                         │                          │
                 Static Astro site on GitHub Pages ◄┘ live fields, follows, feed
```

- **Upstream APIs** are called only by the sync jobs. API keys never reach the browser.
- **Pages** for current-Congress bills and members are prerendered at build time;
  each page then loads its live fields (latest action, status, votes) from
  Supabase, so hourly updates appear without a rebuild.
- **Accounts** use Supabase Auth email magic links.

See [`docs/decisions.md`](docs/decisions.md) for where the implementation departs
from the original build plan and why.

## Repository layout

| Path | What |
| --- | --- |
| `site/` | Astro app (static output, Preact islands) |
| `supabase/migrations/` | Database schema, one SQL file per change |
| `supabase/functions/` | Edge Functions (Deno) |
| `supabase/tests/` | Database tests: RLS, sync jobs |
| `packages/congress-client/` | Typed clients for every upstream source |
| `scripts/` | Backfill and maintenance scripts |
| `.github/workflows/` | CI, deploy, nightly rebuild, backfill |

## Local development

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm install`,
`npm run db:start`, `npm run db:reset`, then `npm run dev`.

## License

[MIT](LICENSE). Congress.gov, senate.gov and congress-legislators data are in the
public domain; Open States data is CC0.
