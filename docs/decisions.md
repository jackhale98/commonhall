# Decisions log

Where the build plan proved wrong or underspecified, the change and the reason are
recorded here. Newest last.

## 1. Paginate Congress.gov by offset, not by following `pagination.next`

**Plan:** follow `pagination.next` until absent.
**Finding:** the live API returns malformed `next` links, with the path repeated
inside the query string, e.g.
`https://api.congress.gov/v3/bill/119?/bill/119?limit=3&sort=updateDate desc&offset=3&limit=3&format=json`
(recorded in `packages/congress-client/test/fixtures/congress/bills-list.json`).
**Decision:** `next` is used only as the "more pages exist" signal; the client
requests the next page itself by advancing `offset`. It also stops when
`offset >= pagination.count`.

## 2. List-level `updateDate` is a date, not a date-time

**Finding:** bill list items carry `updateDate: "2026-10-08"` (no time), even though
`fromDateTime` filters on the full timestamp.
**Decision:** the bill cursor is not "max `updateDate` seen". Each run works
through a fixed window `[from, to]` where `to` is the time the window opened. If a
run stops early (budget or time), it stores the window and the IDs already
processed; the next run lists the same window again from the start (one request
per 250 bills) and skips those IDs. When a window completes, the cursor becomes
`to` minus five minutes of overlap.

Resuming by *offset* was tried first and rejected: when an already-processed
bill is updated again it leaves the window, every later item shifts left, and
the bills that shift past the stored offset are skipped for good. A test
(`supabase/tests/sync-bills.test.ts`) covers this case.

## 3. Census geocoder: pin the district layer to the sitting Congress

**Finding:** the default `Current_Current` vintage already returns
"120th Congressional Districts" (mid-decade redistricting). An Austin address is
TX-10 on those lines but TX-37 for the sitting 119th Congress.
**Decision:** the geocoder looks for the layer named for the current Congress and
falls back through older vintages (`ACS2025_Current`, `ACS2024_Current`, …) until
it finds it. State legislative districts keep the newest lines. Federal reps come
from our own `members` table by state and district; state legislators come from
Open States `people.geo` by coordinates.

## 4. House roll-call member positions arrive in one response

**Plan:** fetch `/members` per vote in two pages.
**Finding:** the recorded response for 119-1-17 returns all 434 positions with no
`pagination` block, even with `limit=250`.
**Decision:** the client still loops defensively (by offset) in case that changes,
but expects one request per vote.

## 5. Shared hourly request budget

The backfill (GitHub Actions) and the hourly sync (Edge Function) use the same
Congress.gov key, so per-run caps alone could exceed 5,000 requests/hour together.
**Decision:** every job records its requests in `api_usage` (per API, per clock
hour) and starts with `min(own cap, 4,800 − used this hour)`.

## 6. Job locks are leases, not advisory locks

Edge Functions may connect through a transaction-mode pooler, where session-level
advisory locks are not reliable. `sync_lock` holds a lease with an expiry
(`try_sync_lock` / `release_sync_lock`), so a crashed run's lock frees itself.

## 7. Vote pages use a query-string route

**Plan:** `/votes/[id]/`, client-rendered.
**Decision:** GitHub Pages cannot serve an arbitrary path without a prerendered
file, so the client-rendered vote page lives at `/vote/?id=house-119-2-80`
(mirroring the `/bill/?id=…` fallback).

## 8. `sync-federal` runs every 10 minutes, not hourly

**Plan:** hourly Edge Function, stop at 3,500 requests.
**Finding:** Edge Functions on the free plan stop at 150 s of wall-clock time, so
one run can make only a few hundred requests even with a little concurrency.
**Decision:** pg_cron calls `sync-federal` every 10 minutes. Each run stops after
120 s (`SYNC_TIME_LIMIT_MS`) or 580 requests (`SYNC_FEDERAL_RUN_CAP`), whichever
comes first, syncing three bills at a time; six runs an hour stay near 3,500
requests. "Within one hour of updateDate" still holds.

## 9. A 429 pauses the job instead of retrying

api.data.gov answers 429 when the key's hourly quota is spent, so retrying inside
a run only wastes the run. A 429 is retried only when `Retry-After` is 30 s or
less; otherwise the client throws `RateLimitedError` (a kind of
`BudgetExhaustedError`), marks the budget spent, and the job checkpoints and
resumes on its next run. 5xx and network errors are still retried with
exponential backoff; other 4xx are not retried.

## 10. Jobs connect to Postgres directly; Actions uses the pooler URL

The sync code writes with postgres.js (transactions, conditional upserts) rather
than through PostgREST with the service-role key. Edge Functions get
`SUPABASE_DB_URL` automatically. The backfill in GitHub Actions needs a
`SUPABASE_DB_URL` secret, and it must be the **Supavisor session pooler** URL
(IPv4), because Actions runners cannot reach the IPv6-only direct database host.
`SUPABASE_SERVICE_ROLE_KEY` is not needed by any job so far.

## 11. Backfill walks bill numbers instead of paging the list

Bill numbers are assigned densely in order of introduction, so the backfill
iterates `1..max` per bill type with a cursor of (type, next number). This is
stable while the list endpoint's order is not, and gaps are simple 404s. When it
finishes, it sets the hourly sync's cursor to the backfill's start time minus
the overlap, so changes made during the (day-long) backfill are picked up.

## 12. Scheduled functions authenticate with a shared secret

Gateway JWT verification accepts any valid project JWT, including the public
anon key, so it cannot protect the sync functions. They are deployed with
`verify_jwt = false` and require an `x-sync-secret` header that matches the
`SYNC_SECRET` function secret; pg_cron reads the same value from Vault.

## 13. No Deno lockfile for Edge Functions

Supabase's edge runtime (Deno 2.1-compatible) cannot read lockfiles written by
newer Deno CLIs. `supabase/functions/deno.json` sets `"lock": false` and pins
exact npm versions in its import map instead.

## 14. "Unread" compares when we recorded an event, not when it happened

**Plan:** unread = `occurred_at > feed_reads.last_seen_at`.
**Finding:** `occurred_at` is the upstream date (actions only carry a calendar
date). An action dated today but synced at 3 pm would already look "read" to
someone who checked the feed at noon.
**Decision:** `feed_events` has both `occurred_at` (display and ordering) and
`created_at` (when the sync recorded it); unread is
`created_at > last_seen_at`.

## 15. Feed events can name a legislator

`feed_events.member_type` / `member_id` record the legislator an event is about
(the sponsor of a new bill, a new cosponsor). The `feed` view unions events on
followed targets with events about followed legislators, so following a member
shows their new bills and cosponsorships without per-follower rows. The
Library of Congress's copy of a chamber action ("Passed/agreed to in House: …")
shares a dedupe key with the chamber's own entry, so followers see one event.

## 16. Pending follows live in localStorage; magic links use the implicit flow

**Plan:** remember the intended follow in `sessionStorage`.
**Finding:** magic links usually open in a new tab (or another device), where
`sessionStorage` is empty.
**Decision:** the pending follow is kept in `localStorage` for at most an hour
and cleared once used. Auth uses supabase-js's implicit flow so a link opened
in a different browser or device still signs in (PKCE requires the same
browser that requested the link).

## 17. Account deletion goes through an Edge Function

Deleting a row in `auth.users` needs the service role, so `delete-account`
identifies the caller from their access token and deletes them with the Auth
admin API. Follows, profile and read marker go with them via `ON DELETE
CASCADE`.

## 18. supabase-js loads only for signed-in users

Public pages read Supabase with a ~1 KB PostgREST helper. Islands check for a
stored session (`localStorage['civic-auth']`) before importing supabase-js, so
anonymous visitors never download it. A user can follow at most 500 items.

## 19. House votes: Congress.gov coverage, positions-based totals

The Congress.gov House roll-call endpoints cover votes tied to legislation; the
Clerk's other roll calls (Speaker elections, quorum calls, some procedural
votes) are not in the API, so they are not in v1. Adding them would mean reading
`clerk.house.gov` XML, a new data source, so it is left for the owner to decide.
House totals are computed from the member positions; `scripts/verify-votes.ts`
compares stored totals with the Clerk's XML (and Senate totals with senate.gov's
XML and vote menu). Senate totals are taken from each file's `<count>` block.

## 20. Senators who leave mid-Congress

Senate XML identifies senators by LIS ID, and congress-legislators' *current*
file drops senators as soon as they leave (two did in 2026). The backfill
also reads `legislators-historical.json` (13 MB) to store exact LIS IDs for
anyone who served this Congress; the daily Edge Function skips that file and
the vote sync falls back to last name + state among senators in `members`.

## 21. Followed members' votes are computed, not stored per member

As the plan specifies, the `feed` view joins `vote_positions` for followed
members, so there are no per-member vote events. Each vote on a bill writes one
`feed_events` row for that bill. Vote-with-party rates come from the
`member_vote_stats` view (majority of the member's own party among yea/nay
votes; not shown for independents).
