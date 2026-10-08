# Contributing

Thanks for helping. Civic Tracker is a small, forkable stack: an Astro site, a
Supabase database and a few scheduled jobs.

## Setup

Requirements: Node 22+, Docker (for local Supabase), and optionally Deno 2 to
type-check Edge Functions.

```sh
npm install
npm run db:start      # supabase start: Postgres, Auth, REST and functions in Docker
npm run db:reset      # apply migrations and load supabase/seed.sql
cp .env.example site/.env   # then paste the local anon key printed by `supabase status`
npm run dev           # site on http://localhost:4321
# Quicker builds while working on templates: SITE_MAX_BILL_PAGES=200 npm run build
```

No API key is needed to work on the UI: `seed.sql` loads all current members and
50 real bills. Regenerate it with `scripts/make-seed.ts` (see the header of that file).

## Checks

Run these before opening a pull request; CI runs the same:

```sh
npm run lint          # ESLint + Prettier
npm run typecheck     # tsc for packages/scripts, astro check for the site
npm test -- --project unit   # API client, status logic, site helpers (fixtures only, no network)
npm run test:db       # migrations, RLS and sync jobs against local Supabase
                      # (uses your local DB, then reloads supabase/seed.sql when it finishes)
(cd supabase/functions && deno check */index.ts)
```

## Rules

- Never commit API keys, service-role keys or downloaded data. Tests use recorded
  responses in `packages/congress-client/test/fixtures/` and the seed dataset.
- Every table in `public` must have row-level security enabled (a test enforces it).
- Scheduled jobs must be idempotent and resumable: a crash mid-run must be safe to rerun.
- Verify Congress.gov field names against the published OpenAPI document
  (`packages/congress-client/openapi/openapi.json`, regenerate types with
  `npm run gen:types`) and against a real response before writing a parser.
- Ask before adding a paid service or a new upstream data source.
- If a decision in the build plan proves wrong, record it in `docs/decisions.md`.

## Layout

```
site/                       Astro app (static output)
supabase/migrations/        SQL, one file per change
supabase/functions/         Edge Functions (Deno)
supabase/tests/             database tests (Vitest + postgres.js)
packages/congress-client/   typed upstream API clients, shared by functions and scripts
scripts/                    backfill and maintenance scripts (Node)
```
