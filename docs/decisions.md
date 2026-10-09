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

## 37. Member photos are hotlinked, not stored

Photos load in the visitor's browser straight from their source; none are
downloaded, committed or copied into the build. Members of Congress use the
Congress.gov image URL from the members sync, falling back to the public-domain
[unitedstates/images](https://github.com/unitedstates/images) portrait for the
bioguide id (the project behind congress-legislators, which we already use), then
to initials. A small handler in the page head swaps in the fallback when an image
fails, so it also works on prerendered pages without hydration. State legislators
use the Open States image. Boston councilors have no photo source in Legistar;
using boston.gov photos would be a new data source and needs the owner's approval.

## 38. Navigation: Boston lives under "States & local"

A top-level "Boston" tab made a single city look like a peer of Congress. The
navigation is now Bills, Members, Votes, States & local, Discuss. Boston pages sit
under States › Massachusetts › Boston, the Massachusetts page has a "Local
government" card, the states index features Massachusetts and Boston, and the home
page shows the levels side by side (Congress, Massachusetts, Boston, all states).
More cities can be added the same way.

## 39. Charts are static SVG rendered at build time

Charts (chamber seats, bill pipeline, vote and party splits, policy areas, the
state tile map, the Boston district map, member and councilor stats) are small
Preact components that render to plain SVG or HTML with no chart library and no
client JavaScript; the same components work inside islands. Party colours appear
only as data marks; the site's brand colour is a neutral teal. Every chart has a
text equivalent (aria-label, legend or a table behind "Show as a table").

## 40. Dark mode for the Pol.is embed

Pol.is has no theme option (`embed.js` reads no colour or theme attribute) and its
pages ignore `prefers-color-scheme`. The frame is cross-origin, so its styles
cannot be changed. In dark mode the site inverts the frame with
`filter: invert(0.92) hue-rotate(180deg)`, following both the system setting and
the site's own theme toggle. Text, buttons and the agree/disagree icons keep their
meaning; any photos inside the embed would look inverted, but conversations here
use Pol.is's generic avatars. If Pol.is adds a dark theme, switch to it.

## 41. Campaign finance from OpenFEC, aggregates only

Approved by the owner. Member pages show FEC data for the member's current
campaign: totals (raised, spent, cash, debt), sources (small and large individual
donations, PACs, party, the candidate's own money, transfers), donation sizes,
in-state versus out-of-state itemized money, the employers donors list, and the
largest PAC contributions. FEC candidate IDs come from congress-legislators
(`id.fec`, matching the member's chamber); the election year is the last year of
the current term.

- Only aggregates and committees are stored and shown. Individual donors' names
  and addresses are never stored, even though the FEC publishes them.
- "Top donor employers" is labelled as personal donations grouped by employer,
  because companies cannot give to candidates directly.
- PAC contributions use itemized receipts on line 11(c) of Form 3 (other
  political committees), summed per committee. ActBlue/WinRed conduit rows, the
  candidate's own joint fundraising committees and bank interest are excluded.
- `sync-finance` runs hourly, refreshes members whose data is over 7 days old
  (never-fetched first, then followed members), 6 requests per member, under an
  hourly cap well inside the 1,000/hour key limit. `updated_at` changes only when
  the numbers do.

## 42. Votes sync newest first

Both chambers load the newest roll calls first, and the Senate (capped per run)
runs before the House, so a partial load already shows recent votes and neither
chamber waits for the other to finish. Stored roll calls are skipped by checking
the database, so the order does not affect resuming.

## 43. Executive orders and nominations

Approved by the owner. `/executive/` shows executive orders (Federal Register API,
no key) and presidential nominations (Congress.gov, the existing key), refreshed
hourly by `sync-executive`.

- Orders since 2009 are shown; the table holds whatever the Federal Register lists
  (1994 onward, about 1,600 rows). Terms are runs of consecutive orders by one
  president, so a second, non-consecutive term counts separately. "Revokes" and
  "Revoked by" come from the Federal Register's disposition notes, read in both
  directions.
- Nominations come from the list endpoint only (one request per 250), which
  carries the description, organization, civilian or military flag and latest
  action. Status is read from the latest action text. Nominee and position are
  parsed from the description for civilian nominations; military promotion lists
  are counted, not listed.
- Senate roll calls on a nomination store `votes.nomination_id` from the vote's
  document (`PN615-2` → `119-pn615-2`), so confirmations link to the recorded vote.
- New tables are read with a fallback at build time: when a migration has not
  reached the database yet, the section shows as not loaded instead of failing
  the build. The site also rebuilds after each Supabase deploy.

## 44. The Supreme Court has its own page

Approved by the owner. The Court is a separate branch, so it has its own page and
menu item ("Court"), not a section of the executive page. Decisions come from
CourtListener's v4 search API (`court_id:scotus`), one row per opinion cluster,
the last five October Terms, refreshed hourly; each run re-reads the last month
because citations and separate opinions are added after release. The token is a
Supabase secret and is sent in a header, never in the URL.

- Opinion types come from CourtListener's index (`lead-opinion`, `dissent`, …).
  Many Supreme Court decisions are stored as one `combined-opinion` document, so
  dissents and concurrences are shown only when listed separately, and the site
  never labels a decision unanimous.
- Nominations to the Court come from the nominations table, so a vacancy and its
  confirmation show up on the Court page too.

## 45. Discussions on orders and rulings; local first

Approved by the owner. Discussions and discussion requests can target an
executive order (Federal Register document number) or a Supreme Court decision
(CourtListener cluster id), alongside bills, Massachusetts bills and Boston council
matters. Each order and decision has its own page (`/executive/orders/{doc}/`,
`/court/cases/{id}/`) carrying the usual "Ask for a public discussion" control, and
the executive and court lists mark items with a discussion. Both are national
(`federal` jurisdiction).

Local discussions come first: the discussions page groups open discussions as
Boston, Massachusetts, then national; the Boston page always has a "Have your say"
section, and the Massachusetts page lists open state and Boston discussions.

## 46. Committees

Approved by the owner. Committees, subcommittees and rosters (with chair and
ranking member) come from congress-legislators, the public-domain source we already
use for member details; the Congress.gov API has no membership data. Its codes map
to Congress.gov system codes (`HSAG` → `hsag00`, subcommittee `15` → `hsag15`).

- Which committees a bill went to is read from the bill's own actions, which name
  their committees, so it costs no extra requests for bills synced from now on.
  Bills loaded earlier are caught up 60 an hour (one actions request each),
  most recently active first. "Reported" is the first action naming the committee
  whose text says it reported the bill.
- Hearings and markups come from Congress.gov's committee-meeting endpoints: the
  list (newest updates first) and one detail request per new or changed meeting.
  The first run reads the last 60 days of updates, which includes everything
  upcoming. The live API names the id `eventId` (the spec says `eventid`).
- `sync-committees` runs hourly within its own cap of Congress.gov requests;
  rosters refresh once a day and are not replaced if the upstream file shrinks
  by more than half. Committees have no top-level menu item (the menu is full);
  they are linked from Members, member and bill pages, the footer and search.

## 47. Open participation in discussions, for now

Requested by the owner. Until the site has a following, anyone may vote and add
statements without an account, and anyone may ask for a discussion. Signed-out
participants are anonymous to this site: no identifier is sent to Pol.is, which
keeps their votes together with its own cookie. "Residents only" is shown as a
request. Signed-out discussion requests use a random per-browser id and a
site-wide cap of 300 an hour. `PUBLIC_OPEN_PARTICIPATION=false` restores sign-in
and residency checks without a code change.

Draft discussions are visible only to maintainers, so the client-rendered
discussion page retries with the signed-in session when the public lookup finds
nothing; that lets maintainers preview a draft (and create its Pol.is
conversation) before opening it.

## 48. Search that finds what people type

Whole-word full-text search missed acronyms and partial words ("EA" did not find
the EARA, but did find summaries mentioning an "EA") and ignored bill numbers.
`search_bills` now: treats a bill number in any common form ("H.R. 677",
"hr677", "s 5") as a lookup; ranks short titles that equal or start with the query
first, then titles containing every word as a word prefix, then ordinary
full-text matches (summaries included); and, only when nothing matches, falls back
to titles whose words are spelled like the query's (pg_trgm word similarity), so
typos work without adding noise to good searches. `search_local_matters` gets the
same prefix matching and docket-number lookups ("2026-1882", "#1882", "1882").

Short titles "for portions of this bill" are no longer chosen as a bill's title
when a whole-bill title exists (H.R. 1 showed as "FEHB Protection Act of 2025").
`bills.titles_rev` records which rule picked each title; `sync-committees`
re-checks older bills 60 an hour.

## 49. Boston loads meetings first and recent matters first

The first Boston load walked every council matter *modified* since January 2024,
oldest first, and only then read meetings. Old matters are touched constantly, so
that was 32,691 matters (about 65,000 requests), re-listed on every run, and with
four short runs a night meetings never arrived. Now each run reads meetings first
(six months back plus everything upcoming on the first run, then changes); the
first matters load walks only matters *introduced* since the start date, newest
first, one page of 100 at a time (about 3,000 legislative matters); afterwards it
follows changes since the load began and ignores older matters that were only
touched. The job runs every 15 minutes; a quiet run costs two list requests.

## 50. The committees page is an explorer with activity charts

The committees page leads with what committees are doing: stat tiles, a weekly
column chart of hearings, markups and other meetings (16 weeks back, 3 ahead,
scheduled weeks lighter), and the busiest committees as stacked bars (subcommittee
meetings counted toward their committee). Both charts are static HTML/CSS with
hover and keyboard tooltips, a legend, and a "Show as a table" view. Meeting types
use their own three colours (`--cat-hearing`, `--cat-markup`, `--cat-other`),
validated for colour-blind separation, lightness, chroma and contrast in light and
dark mode; the site's brand colours failed those checks for this job.

Below the charts, an explorer filters committees and meetings together by search
(committee names, hearing titles, witnesses), chamber, committee (with its
subcommittees), meeting type and time (coming up, last 30 days, this Congress). It
opens on "coming up" only when something is scheduled, otherwise on the last 30
days. Field hearings' addresses arrive from Congress.gov as JSON; they are now
shown as "building, city, state".

## 51. The header search covers orders, hearings, nominees, cases and Boston

The prerendered search index now includes executive orders, Supreme Court
decisions, committee hearings and markups (the past year and anything scheduled),
civilian nominations and recent Boston council matters, alongside members, states
and pages. It is about 66 KB gzipped. Bills are too many to prerender, so while
you type the palette also asks `search_bills` for the top matches (debounced, two
characters or more) and lists them after the instant hits, followed by "Search all
bills".

## 52. Supreme Court decisions load a month at a time

The first load asked CourtListener for every decision since October 2020 in one
paged query, and production stopped at 100 (June 2025 onward). The load now asks
for one calendar month per request, oldest first, recording each finished month
in the cursor (`filledThrough`), so it resumes where it stopped and no query
comes near a paging limit. About 73 requests, well inside the 5,000 an hour a
token allows. Existing installs have no `filledThrough` yet, so their next run
fills the missing years. After the load, each run re-reads the last 30 days as
before.

## 53. The finance job fills missing FEC ids itself

Members' FEC candidate ids come from congress-legislators through the daily
members sync, which also needs Congress.gov requests and can lose them to a
running backfill. After the finance feature shipped, no member had an id yet, so
finance had nothing to fetch. Once a day, when any current member lacks an id,
`sync-finance` now reads `legislators-current.json` (a static file outside every
request budget) and fills only the missing ids and election years.

## 54. The project is named CommonHall

The site moved to commonhall.org and the default site name is now CommonHall
(`PUBLIC_SITE_NAME` still overrides it). The repository is renamed
`jackhale98/commonhall`; the footer link, the user agent sent to data providers and
the docs use the new name. Internal names stay as they were: the `@civic/*`
workspace packages and the `civic.*` browser storage keys, since renaming them
would churn every import and sign visitors out or reset their saved choices.

## 55. A calmer home page; search and filters for orders and decisions

The home page lost its repeated parts: the "Find your representatives" button (the
lookup is further down), the topic chips (the bills page has topics), and the "Every
level of government" cards (the header has every section). Its search box now opens
the full header search (bills, people, hearings, orders, cases, Boston) and falls back
to the bill search without JavaScript. The numbers row covers all three branches:
bills, new laws, votes, executive orders this term, decisions in the latest Supreme
Court term and committee hearings in the last 30 days. On phones the bill, discussion
and vote lists are shortened.

The executive and court pages get the same search-and-filter pattern as the bills
page. Each prerenders its latest items and loads a compact list built with the site
(`executive/orders.json`, about 33 KB gzipped; `court/cases.json`) for instant
filtering: orders by president's term, year, revoked or not, and having a
discussion; decisions by term, opinion author, argued or not, and having a
discussion. CourtListener delivers most decisions as one combined document, so the
court filters use the author and argument date rather than dissent counts.
