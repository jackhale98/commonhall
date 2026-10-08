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

## 22. Open States: daily budget, rotation, and no page offsets

Open States does not publish its free-tier limits, and they are low. `sync-state`
runs several short times each night (pg_cron, 1–6 a.m. Eastern), spends at most
`OPENSTATES_DAILY_BUDGET` requests per UTC day (default 450, shared through
`api_usage`), spaces requests `OPENSTATES_MIN_INTERVAL_MS` apart (default
1.1 s), and caps pages per state per run. States that users follow or saved in
their profile go first, then the least recently synced. The first full load of
all 51 legislatures therefore takes several nights; after that, each night is
incremental.

Bills are requested oldest-update first with `updated_since` set to the last
`updated_at` seen, always page 1, so bills that change mid-run cannot be skipped.
A page full of identical timestamps steps through pages at that timestamp. When
a state starts a new session, its previous session's bills are deleted (the plan
keeps only the current session). New-bill feed events are written only after a
state's first full load, so the initial import does not create tens of thousands
of events.

## 23. Find my reps

Census Geocoder → districts for the sitting Congress (see §3) → senators and
House member from our `members` table → state legislators from Open States
`people.geo` by coordinates, falling back to matching the Census state-district
numbers in `state_legislators`. Legislators returned by `people.geo` are upserted
so they can be followed. Addresses are never stored or logged server-side;
`people.geo` results are cached by coordinates rounded to about 100 m for 30
days, and uncached Open States lookups are capped at 120 per hour. A signed-in
user can save the matched address and districts to `profiles`; the account page
then lists their representatives from our own tables without calling any API.

State bills and legislators have no page of their own on the site (the plan
calls for trimmed state data); they link to Open States and can be followed.
(Superseded for state bills by #27: notable and followed state bills now have
pages.)

## 24. Acceptance checks as scripts

`npm run verify:votes` (Phase 4) and `npm run verify:reps` (Phase 5) run the
acceptance checks against a real database. During development they passed for
17 roll calls (1 House, 16 Senate; the House sample was limited by DEMO_KEY)
and for 11 addresses in 10 states and DC (federal members; state legislators
need an Open States key).

## 25. Demo build without a database

So the site can be tried before any keys exist, a build with no Supabase
configuration and `PUBLIC_DEMO=true` (set automatically by the Pages workflow when
the `PUBLIC_SUPABASE_URL` variable is empty) reads `site/src/data/demo.json`, a
snapshot of the seed database, instead of PostgREST. Vote pages, normally
client-rendered at `/vote/?id=…`, are prerendered at `/votes/{id}/` in this mode
because there is no live database to query; bill search filters the sample in
the browser; follow buttons, the feed, accounts and Find my reps are hidden.
The snapshot is read only at build time and is not shipped to browsers.

## 26. Build guide rev2: one pull request, existing package names

Rev2 of the build guide (Massachusetts, Boston, discussions, hybrid rendering)
asks for one pull request per phase. This work was developed on a single
designated branch, so it lands as one pull request with a section and acceptance
evidence per phase. The Legistar client lives in `packages/congress-client` next to
the other typed clients rather than in a renamed `packages/clients`, to avoid
churn in every import.

## 27. Hybrid rendering: only notable items are prerendered

Prerendering every bill of a Congress (15,000+) and every state bill would push
the site past the 300 MB budget. The database decides what is notable, in three
id-only views that the build reads with the anon key:

- `bills_prerender`: current-Congress bills past introduction and committee
  (status, or an action text showing a committee report or calendar placement),
  plus any bill with a published discussion or at least one follower.
- `state_bills_prerender`: Massachusetts bills that were reported, passed or
  enacted, plus any state bill that is discussed or followed. Other states get
  pages only when discussed or followed (state bills had no pages before; they
  linked to Open States).
- `local_matters_prerender`: council matters that are discussed or followed.
  Council business is mostly resolutions adopted the day they are filed, so
  "reported by committee" does not apply.

The views are not `security_invoker`: they count follows across users but expose
ids only. Everything else is served by client-rendered fallbacks
(`/bill/?id=`, `/state-bill/?…`, `/boston/matter/?id=`, `/discussion/?id=`).
The 404 page forwards clean URLs to them, and each fallback reads
`/prerendered.json` and goes back to the clean URL if the item has a page (for
example after a rebuild), so shared links settle on the URL with the better
preview. The deploy workflow fails above 300 MB. With the seed data the real
build has 632 pages (14 MB); the demo prerenders everything in its snapshot.

## 28. Boston: Legistar has no council seats

Legistar's office records say who is on the City Council but not which seat they
hold. Seats come from `supabase/data/boston-council-seats.json` (Legistar person
id → district or at-large), checked against boston.gov in October 2026 (District
7 is Miniard Culpepper since January 2026; the Analyze Boston district layer still
names his predecessor). `sync-boston` logs any sitting councilor missing from the
map so the file is updated after elections and vacancies.

## 29. Boston: no roll-call votes in Legistar

Boston records roll calls in meeting minutes (PDF), not as Legistar votes: no
event item has `EventItemRollCallFlag` set and `/votes` is empty for the council.
`local_votes` and the vote ingest exist and are tested, so votes appear if the
Clerk starts recording them, but the guide's "five Boston votes" acceptance check
cannot be met from Legistar. Matter pages say so and link to Legistar. Parsing
minutes PDFs would be a new data source and is left for the owner to decide.

## 30. Boston: only legislative matter types

The council's Legistar body also holds agendas, minutes, reports, communications
and appointments. `sync-boston` keeps ordinances, resolutions, orders, hearing
orders, home rule petitions and similar (`LEGISLATIVE_TYPES`) and skips the rest
without fetching their histories, which keeps the nightly run small.

## 31. Feed: `new_item` alongside `new_bill`

The guide renames the new-legislation event to `new_item`. Existing rows and code
use `new_bill`, so both kinds are allowed: federal and state syncs keep writing
`new_bill`, Boston writes `new_item`, and the feed shows both as new legislation.

## 32. Council districts from Analyze Boston, loaded by script

`npm run load-districts` loads the 2023-2032 council districts from Analyze
Boston into PostGIS (`council_districts`); `council_district_at()` answers
point-in-polygon lookups for Find my reps. Tests and the seed use a copy
simplified to about 20 m (20 KB), which can misplace addresses within a few
metres of a boundary; production loads the full file. Reload after redistricting.

## 33. Find my reps: the Census match is not always the typed address

The Census geocoder returns the address it matched, which can differ from what
was typed (for example "24 Beacon St 02133" matched an address in Hyde Park).
Districts are computed for the matched address, and the result shows it so
users can tell. The Boston acceptance script uses addresses that match exactly.

## 34. Pol.is embed privacy

By default `embed.js` sends `window.location` (query string and fragment
included) as `parent_url` and `document.referrer`. The island sets
`data-parent_url` to the clean URL, reduces `document.referrer` to the site
origin before loading the script, and sets `data-xid` (a random per-user UUID)
only for users who may take part; others get the embed with `ucv`/`ucw` off.
`npm run check:polis` verifies this in a real browser (docs/discussions.md).

## 35. Seed: Massachusetts legislators, no Massachusetts bills

`supabase/seed-local.sql` (generated by `scripts/make-local-seed.ts`) holds real
Boston data from a Legistar sync, the simplified districts, current
Massachusetts legislators from the public-domain openstates/people repository
(the data behind Open States) and two clearly labelled example discussions.
Massachusetts bills need an Open States key, which was not available while
building this, so the seed and demo have none and MA bill pages were checked with
test rows only. They fill in on the first nightly `sync-state` run, which now
handles Massachusetts first.

## 36. Clearing a saved address keeps the profile row

Find my reps used to delete the profile when a user removed their address. The
profile now also holds the user's Pol.is id, so removing the address nulls the
address and district fields instead; deleting the account still removes the row.
