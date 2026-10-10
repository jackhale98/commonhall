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
hour) and starts with `min(own cap, 4,500 − used this hour)`.

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
comes near a paging limit. About 73 requests (CourtListener's limits have since
tightened; see §74). Existing installs have no `filledThrough` yet, so their next run
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

## 56. A shorter phone home page; the pace of executive orders

The home page drops the parts that repeated others: the open-discussion card in the
hero (the discussions band follows), the "Latest votes" list (the hero shows the
latest vote) and "Where bills stand" (on the bills page). On phones the hero shows
two "Latest" cards and the footer folds into two columns with the data sources on
one line. The phone home page went from about 8,500 px to about 3,800 px tall.

The executive page replaces its two bar lists with one chart: executive orders
signed over each four-year term since 2009, counted from Inauguration Day. It is an
emphasis chart (current term in the accent colour, earlier terms in grey, labelled
at their ends), with a month-by-month readout on hover, tap or arrow keys, and a
table (first 100 days, first year, whole term).

## 57. Who won at the Supreme Court comes from the Supreme Court Database

CourtListener says when a case was decided and by whom, but not who won. The
Supreme Court Database (Washington University, now hosted at Penn State) codes
every decision: the winning party, the disposition and the vote split. It is the
scholarly standard and free. The "Load Supreme Court Database" workflow
(`scripts/load-scdb.ts`, monthly and on demand) finds the newest release, downloads
the case-centered CSV organised by citation (it checks the file name), and replaces
`scotus_outcomes` with every case from 2009. The 2026 release covers through the
2025–26 term; the database codes a term after it ends and leaves out most emergency
applications, so those show no outcome rather than a guess. SCDB's ideological
"direction" codes are deliberately not loaded.

Decisions are matched by term and any shared docket number. The court page shows,
per term, who won (petitioner, respondent, mixed) and how divided the Court was
(unanimous to 5–4), and the list can be filtered by both.

CourtListener sometimes publishes a corrected opinion as a second cluster named
"… Revisions: 7/01/26" (13 of the first 187 decisions). The sync strips the suffix,
marks the row as a revision and drops it once the original decision is stored.

## 58. A short home page; search hints that fit a phone

The home page is now the hero (search and "Latest"), the numbers row, the
representatives lookup and "Moving in Congress". The discussions band and "Congress
at a glance" are gone (the discussions and members pages carry them). "Latest" lists
the newest vote and law, the newest executive order and Supreme Court decision when
they are from the last 30 days (with who won, once coded), the next Boston council
meeting (desktop only) and, last, an open discussion.

Search boxes use short hints ("Keyword or bill #", "Topic or EO #", "Search
everything") that fit a 390 px phone; the labels and help text carry the detail.
The Supreme Court outcome charts start folded on phones.

## 59. Nominations are searchable

The executive page's two fixed lists ("Recently confirmed", "Awaiting the Senate",
20 each) became one explorer over every civilian nomination this Congress: search
by name, position or agency, and filter by where it stands (awaiting the Senate,
confirmed, withdrawn/returned/rejected, all) and agency. Like the orders, it
prerenders the first page and loads a compact list built with the site
(`executive/nominations.json`, about 33 KB gzipped). When Congress.gov gives no
separate nominee or position, both are read from the description ("Keith Heffern,
of Virginia, …, to be Ambassador … to the Gabonese Republic."); the header search
uses the same split.

## 60. Prerender views run with the caller's rights

The three prerender views (`bills_prerender`, `state_bills_prerender`,
`local_matters_prerender`) ran as their owner (SECURITY DEFINER) so they could see
every user's follows, which RLS limits to their owner. Supabase's security linter
flags such views because they bypass RLS for anyone who queries them. Now a trigger
on `follows` keeps `followed_targets` (target type and id only, never a user id),
the views read that table, and they run with `security_invoker = true`. What the
public can learn is unchanged: that an item has at least one follower. Anonymous
callers still cannot read `follows` at all.

The discussions band returned to the bottom of the home page; it lists the open
discussions after the one shown in "Latest".

## 61. State and local pages are short, tabbed and not repeated

`/states/` lost its list of 56 links: the tile map is the picker, with a select for
phones and the territories in one line. A state page is an overview: hemicycles
side by side, a compact Congress delegation (senators and six House members, the
rest folded), recent bills ten at a time, and legislators as a searchable list
(chamber chips, ten at a time) instead of card lists. Massachusetts links to Boston
rather than repeating Boston's district map.

Boston is four linked pages sharing a sticky tab bar: **Overview** (find your
councilor, meetings, the latest matters, 311 at a glance, the next zoning hearings,
discussions), **Council** (matters and meetings), **Neighborhoods** (311 by district,
zoning appeals) and **Budget** (Capital Plan). Each block appears in one place; the
Overview shows a few items and links to the tab that has them all. Lists show five
items on phones and ten on wider screens.

## 62. Consent-agenda resolutions are hidden by default

About 70% of Boston's council matters are consent-agenda resolutions
(congratulations, commendations, memorials). Council lists, counts and the
Overview leave them out unless the reader turns on "Include consent agenda" or
chooses that type; the list of hidden types is one constant
(`HIDDEN_MATTER_TYPES`), and `local_matter_facets` takes it as `p_exclude_types`.
Councilor pages count them separately.

## 63. Boston data from Analyze Boston: 311, zoning and the Capital Plan

Three City of Boston datasets, read from Analyze Boston's CKAN API (no key; the
owner approved each):

- **311** (`sync-boston-311`, daily). Only summaries are stored: per day (Boston
  time), council district, request type and system, the number opened, closed so
  far and closed on time, and the median hours to close. No request, address or
  photo is read. The city runs two systems for different departments (the "NEW
  SYSTEM" for Public Works, Parks and others; the legacy per-year table for
  Transportation and Inspectional Services); they hold different cases, so they are
  added together. The legacy system publishes a day later, so the 30-day window
  ends on the last day both have. The last 14 days are re-read each run because
  requests close late; the first run backfills 90 days, saving its place after each
  fortnight; days older than 120 are dropped (about 25,000 rows). "Typical time to
  close" is the median of each group's median weighted by how many closed — an
  approximation, labelled "typically". A backlog snapshot was dropped: the legacy
  system carries thousands of years-old open cases, which would mislead.
- **Zoning Board of Appeal** (`sync-boston-zba`, daily): open appeals and those heard
  in the last year (about 1,100). The applicant's name (`contact`) is never read.
  The city's table repeats a case number when a hearing is rescheduled; the latest
  row wins. Decision codes become plain words (AppProv → Approved with provisos).
- **Capital Plan** (`sync-capital-plan`, weekly): the current plan's ~325 projects,
  rewritten only when the city's file changes.

The portal's firewall refuses some SQL words (`substr`, `extract`, aggregate
`FILTER`); the queries use `left()`, `date_part()` and `sum(case …)`.

## 64. Zoning cases leave the site once heard

Zoning appeals are public hearings, and the city publishes each one's address and
project so neighbors can testify; listing upcoming hearings serves that. A
searchable archive of decided cases did not: most are ordinary homeowners (a
mudroom, a roof deck), and a permanent list by address mostly lets people look up
their neighbors' renovations. So:

- `zba_appeals` holds only cases with a hearing still to come; each row (address and
  description) is deleted once its hearing date passes or the hearing is cancelled.
- The last 12 months of decisions are kept only as counts per neighborhood and
  outcome (`zba_decision_counts`), shown as totals and an approval rate.
- The Neighborhoods page is `noindex`, so an address on it does not surface in web
  searches; zoning cases are not in the site search; there are no per-case pages.
- Applicants' names were never read. The page points to the city's own records
  for past decisions.

Individual zoning cases cannot be the subject of a discussion, for the same reason.

## 65. Discussions on Boston capital projects

Each Capital Plan project has its own page (`/boston/projects/<id>/`: scope, status
and money by year) with the usual "Ask for a public discussion" button, and
discussions can be about a project (`target_type = 'capital_project'`, target id the
city's project id, e.g. CCC25057). Maintainers open them from the admin page like
any other, usually with Boston (or the project's district) as the jurisdiction.

## 66. Capital Plan figures are checked against the city's own definitions

An audit of every published amount against the city's FY27–31 file and its data
dictionary (October 2026) found the amounts right and four labels wrong, now fixed:

- "Expended" is actual spending *before Year 0*, so it reads "spent through FY25",
  not "spent so far"; Year 0 (FY26) is "budgeted", the plan's years are "planned".
- What remained of a total after the spending columns is External Funds (grants not
  run through the city's capital fund), not "not yet scheduled". For every project,
  expended + year 0 + year 1 + years 2–5 + external funds equals the total budget;
  the sync logs any project where that stops holding, and the page would show the
  difference as "not broken down by the city".
- Negative amounts (reductions) are listed, not dropped; the bar draws the positive
  parts and says so. A −$1 leftover is treated as rounding.
- Headline totals are the sum of total project budgets, which is how the city's own
  Table 1 counts the plan. The city's announced $4.4 billion (322 projects) is the
  April recommended plan; the adopted plan on Analyze Boston has 325 projects and
  $4.47 billion. The Budget page says so. "Under construction" counts the same
  statuses everywhere (In Construction and Implementation Underway: 104).

Money is rounded half up from whole dollars ($2,150,000 → $2.2M); `toFixed` on a
float had rounded some halves down. A script compared all 1,249 non-zero amounts on
the 325 project pages, the Budget headlines and department totals, and the Overview
with the city's CSV: no differences.

## 67. What a Supreme Court case is about: the syllabus and SCDB topics

Two neutral, official sources describe each decision, and nothing is paraphrased:

- **Topic**: the Supreme Court Database's issue area (14, e.g. Criminal Procedure)
  and specific issue (e.g. search and seizure), from the file the SCDB loader already
  reads. Labels are SCDB's codebook wording, cut to their first clause; "miscellaneous"
  codes show no label. Recent decisions have none until SCDB's next release.
- **Background**: the part of the Court's syllabus before "Held:" — prepared by the
  Reporter of Decisions, "no part of the opinion of the Court" — word for word, read
  once per case from the opinion text CourtListener stores (one request per case,
  then re-checked daily for a month). Only re-flowed: page headers, footnotes and
  line-end hyphens are removed (a hyphen is kept when the opinion spells the word
  with one elsewhere). The holding is left out; the outcome line already says who won.

The syllabus summarizes the majority opinion and uses its wording, so the page names
its author and says it is not part of the opinion. Text with lost ligatures (some
PDFs turn "filed" into "fled", "first" into "frst") is rejected rather than shown:
those cases show their topic only. Lists show the first 180 characters; case pages
show the opening sentences with the rest folded.

## 68. Boston's operating and revenue budgets

The Budget tab now covers the whole city budget, not only the Capital Plan: the
adopted operating budget (what the city spends to run departments) and the revenue
budget (where the money comes from), from Analyze Boston's "operating-budget" and
"revenue-budget" files (owner approved; found with Boston's open-data MCP server, which
wraps the same API the sync calls directly). `sync-city-budget` runs weekly and reads a
file only when the city has changed it.

The files name their year columns ("FY24 Actual Expense", "FY26 Appropriation",
"FY27 Budget"), so columns are recognised by pattern and stored one row per line and
year in `city_budget_lines`; next year's file needs no code change. "#Missing" cells
are left out, not counted as zero. The operating file ends with a grand-total row
(every label blank) that would double the budget; total rows are skipped and the site
adds the lines itself. Checked against the city: FY27 spending and revenue both total
$4,942,387,983 (+$29 million, 0.6%, on FY26), property tax 73% and state aid 11% of
revenue, as the city states. Department changes compare with the prior year as
appropriated (amended), which is what the city's file gives.

## 69. Saved locations keep no street address

Find my reps used to save the matched street address with a user's districts, to show
it back to them. Nothing needs it: the feed and discussion residency use the districts.
Now only the town, state and ZIP are kept ("Washington, DC 20500"). The browser saves
that form, and a trigger on `profiles` (`private.area_label`) cuts every write to it,
so an old cached page cannot store a street; when a street cannot be told apart from
the place, nothing is kept. The migration rewrote existing labels the same way. The
privacy page says so. Addresses still go to the Census Geocoder for the lookup and are
never stored or logged by us.

## 70. State bills: legislators first, a fair share, newest bills first

Open States' free key allows about 500 requests a day and returns 20 bills a page.
The first version read one state at a time, oldest-updated bills first, with
Massachusetts always first, so other states waited for Massachusetts to finish and a
state's page showed its oldest bills for weeks. Now `sync-state`:

- loads legislators for every state (a few requests each) before any bills, so every
  state page has its legislature after one night;
- reads bills in rounds that alternate first-class states (Massachusetts) with each
  other state in turn: Massachusetts gets about half the requests and every state
  moves forward every night;
- loads a state newest-updated first (page by page, saved after each), so its recent
  bills appear after one request. It records the newest timestamp when the load
  begins; when the load ends it switches to the existing catch-up (oldest first from
  that timestamp, always page 1), which gets anything updated during the load. Paging
  newest-first can only repeat a bill (when one is updated and moves to the top), never
  skip one. A state part-loaded by the old oldest-first load stops when it reaches
  the bills it already has.
- checks loaded states for changes once a day (Massachusetts every run), so those
  checks don't use the budget first loads need.

Open States' bulk downloads need a signed-in account and are monthly, so they are
not used. A higher API limit, which Open States grants civic projects on request,
would finish the first load in days.

`sync-state` runs hourly at :07 (it ran ten times between 06:00 and 10:30 UTC). The
daily budget resets at midnight UTC, so the 00:07 run starts each day's requests about
six hours sooner; runs after the budget is spent stop at once.

## 71. Party unity and campaign-money leaderboards

The members page shows two things in folded sections (they began on their own page, `/members/insights/`, which now redirects; see §72).

**Party unity** (view `member_party_unity`) uses the usual CQ definition. A party-line
roll call is one where most voting Democrats and most voting Republicans took opposite
sides. A member's score is the share of those roll calls where they voted with their own
party's majority. Only yea and nay votes count. The page ranks current members only, and
only those who voted on at least half of their chamber's party-line roll calls, so a
member who joined late or missed many votes doesn't top or bottom a list on a handful of
votes. Independents have no party majority to measure against and aren't ranked. The
score describes how members voted, not their ideology.

**Campaign money** adds up each member's FEC report. For each member the finance sync
keeps the 25 largest PAC contributors (built from the 100 largest PAC receipts) and the
25 employers whose workers gave the most (from the top 40). Until 9 October 2026 it kept
10 of each, and rows refresh weekly. It already fetched these rows, so keeping more costs
no extra requests. Totals are summed
across members and split by the recipient's party. Because each member contributes only
a top-25 list, every total is a floor. Employer totals are gifts from people who work
there, not from the company. Retired, self-employed and blank employers are skipped. The
page states how many members' reports have loaded.

Also: the orange Massachusetts tile on `/states/` was labelled "Full coverage", which
read as "fully loaded". It now says "Featured state". All states sync the same data; the
featured state's bills sync first and get their own pages.

## 72. Members page: find first, list on demand

On a phone the members page listed all 539 members in 56 state cards, about 33,700px,
and the search box sat below the first screen. Visitors come to find one person, their
own members, or a state's delegation, so the page now leads with the ways to find them:

- A search box that matches names, states ("Texas", "TX") and seats ("MA-7", "ny 14"),
  with state, party and chamber filters. It stays pinned under the header while
  results show. Results are rows of 44px, 25 at a time with "Show more".
  A state's members are listed by seat (senators, then districts); everyone else by
  name.
- "Find your representatives" by address (the shared lookup; signed-in visitors with a
  saved address see theirs), and the members they follow.
- A grid of state codes; a tap shows that state's members, linking to its state page.
- Party unity and campaign money, folded by default.

Filters live in the URL (`?q=`, `?state=`, `?party=`, `?chamber=`), so a state's
delegation or a search can be linked. Every member is still in the HTML, so search
engines and readers without JavaScript see the full list; with JavaScript, only
results show. The chamber charts appear on wider screens; phones get one line of seat
counts. The page is about 2,500px tall on a phone before a search.

## 73. Navigation by level of government

The header had seven flat links, Committees didn't fit, and Massachusetts and Boston
were only reachable through States & local. The top bar is now grouped:
**Congress** (Bills, Members, Votes, Committees), **Executive**, **Court**,
**States & local** (All states › Massachusetts › Boston), and **Discuss**.

- Congress and States & local open a small menu on click, not on hover. Hover menus
  are unreliable on touch screens and for keyboard and screen-reader users. Without
  JavaScript the menus open on focus, and the footer still lists every page.
- Pages in a group show its items as a row of tabs under the header, so sibling pages
  stay one tap apart and the active one is marked. For States & local the row reads
  as a trail, which replaces the Massachusetts and Boston breadcrumbs.
- Phones get their own menu (`PHONE_NAV`): every page sits under a heading (Congress;
  White House and courts; States & local; Take part), one link per row, all the same
  size, with nothing to open, so any page is one tap from the menu. An earlier version
  reused the header's groups, mixing headed groups with bare links that looked like
  headings.
- There's no Congress landing page; the home page already does that job.
- `lib/nav.ts` holds the structure. A page's group and tab come from its path, so pages
  don't declare them.

## 74. CourtListener's limits: 5 a minute, 50 an hour, 125 a day

The sync assumed CourtListener's old 5,000 requests an hour. A standard account now
gets 5 a minute, 50 an hour and 125 a day, over rolling windows. On 9 October the
re-read of five terms used the day's allowance in one afternoon. After that, every
hourly run's first request got a 429 asking for about a minute's wait, and the client,
which gives up on any wait over 30 seconds, ended each run without loading anything.

The Supreme Court sync now:

- spaces its requests at least 13 seconds apart, and waits out a Retry-After of up
  to 65 seconds rather than giving up;
- takes at most 10 requests a run, 45 in a clock hour and 110 in any 24 hours,
  counted in `api_usage` (`DAILY_LIMITS` in `job.ts`);
- when a longer wait is asked for, records it in the cursor and sends nothing until
  the wait has passed.

At about 110 requests a day, the remaining month re-reads take about a day and the
syllabi (one request per case) about five more. New decisions afterwards need only a
few requests a day. A Free Law Project membership raises the limits; we haven't
taken one.

## 75. A loading animation from the logo

Page-level waits (the vote, member, bill, discussion, council matter and state bill
pages that load in the browser, the feed, and the Following list) show `Loader`: the
logo's seven seats fill in one at a time, the amber dot arrives and "strikes" like a
gavel, and a short line rotates through roll-call phrases ("Calling the roll…",
"Checking for a quorum…"). Buttons show the mark alone, beside their own text.

- Screen readers hear a single "Loading …" status naming what is loading. The rotating
  phrases are hidden from them, so nothing is re-announced every few seconds.
- It fades in after a quarter of a second, so fast loads never flash it.
- With reduced motion, the seats still fill in turn but nothing moves or bounces.
- No phrase suggests the visitor has done something they haven't ("Casting your
  ballot…" became "Taking our seats…").
- Short status lines inside lists ("Loading every order…") stay as text.

## 76. State legislators' details and committees from openstates/people

The Open States API is the state sync's only source, and its free allowance (about
500 requests a day) goes on bills. Legislators held just name, party, seat, email
and photo, and only for the states the sync had reached (3,048 of about 7,400). No
committees at all.

Open States publishes the data behind its API as a public-domain (CC0) GitHub
repository, `openstates/people`: one YAML file per legislator (offices, phones,
links) and per committee (members and their roles). The owner approved it as a
source on 10 October 2026. The "Load state people and committees" workflow
downloads the repository archive weekly and runs `scripts/load-state-people.ts`.
It uses none of the API allowance and runs in GitHub Actions, not an Edge Function,
because parsing about 10,000 files is too much work for an Edge Function's CPU limit.

- Legislators now come only from this load. The API sync stopped fetching them (a
  few requests per state a week), so its whole allowance goes on bills. A new
  legislator appears within a week, not a day. The load adds offices and links,
  fills a missing email or photo, and marks as former those who left the
  repository's legislature folder (only when the state's list looks complete,
  more than 20 people).
- Each state's committees are replaced on every load (`state_committees`,
  `state_committee_members`). Congress's files (`data/us`) are skipped; Congress has
  its own committee data.
- The state bill sync now keeps every sponsor (`state_bill_sponsors`), not only the
  first. It was already reading them. Bills stored earlier fill in as they change.
  Until then, legislator pages also count the bills where they are the main sponsor.
- Legislator (`/state-legislator/?id=`) and committee (`/state-committee/?id=`)
  pages are rendered in the browser, like other state pages, so 7,400 people and
  2,800 committees don't add to the build. Like Congress's Committees tab, each
  state with committees gets an Overview / Committees tab row and a prerendered
  page per state (`/states/ny/committees/`) listing every committee by chamber
  with its chairs. Chamber names follow the state ("Assembly" in New York,
  "House of Delegates" in Virginia). Legislator names across the site link to
  their page.

## 77. Massachusetts in full, other states slim, and trimming past Congresses

The database must stay under 400 MB. On 10 October 2026 it was 142 MB, and the
national state-bill backfill alone could add 70–100 MB, plus 50–90 MB if every
state's co-sponsors were kept. So:

- **Massachusetts (first-class) bills** keep everything: every sponsor, the full
  action history (`state_bill_actions`), roll-call votes with each legislator's vote
  (`state_votes`, `state_vote_positions`) and the summary. The detail comes in the
  same Open States requests (`include=actions,votes,abstracts`), so it costs no extra
  requests. Its bills were read once more to fill in the history.
- **Other states' bills** keep one row each: title, latest action, main sponsor and
  topics (subjects, all states, about 5–10 MB at full load). Their co-sponsors are
  no longer kept, and those already stored were deleted. Each bill links to its full
  history on Open States.
- **State party unity** (`state_party_unity`) uses the same method as Congress's
  (§71), from Massachusetts roll calls. Legislator pages show it after at least five
  party-line votes, with their recent votes.
- **Session dates** (`state_sessions`, from the Open States jurisdictions request the
  sync already makes weekly) give each state page a line such as "In session: 194th
  General Court, January 2025 to December 2026."
- **Statewide officials** (`state_executives`: governor, lieutenant governor, attorney
  general, secretary of state, treasurer, auditor) come from the same weekly
  openstates/people load, `data/{state}/executive`. Under 1 MB.
- **Past Congresses.** `private.trim_past_congresses()` runs monthly. For bills and
  votes before the current Congress it deletes action histories, co-sponsors and
  member-by-member positions, and keeps the bills and vote totals. Congress.gov keeps
  the full record. It does nothing until the 120th Congress begins in January 2027;
  without it the federal tables (about 75 MB) would double every two years.

Expected size once everything has loaded: about 290–325 MB.

## 78. Senate amendment votes link the bill they amend

senate.gov's roll-call file names the amendment as the document for amendment
votes (and for cloture, tabling and budget-waiver motions on amendments), so those
votes were stored with no bill: the vote page showed no bill link and the bill page
left them out. The sync now falls back to the file's `amendment_to_document_number`
("S. 4668"), which names the underlying bill even for second-degree amendments.

Migration 037 repairs what was stored. Where the question names the bill ("… to
S. 4668 (…)") it sets the link directly. Budget-waiver motions ("… Re: Schiff Amdt.
No. 5740") don't, and stored roll calls are never re-read, so the current session's
unlinked amendment votes are deleted and the next federal sync (every 10 minutes)
fetches them again with the link. All 29 such votes were in the current session.

## 79. A state's pages as tabs

A state's page had grown into one long scroll: the legislature, statewide officials,
the delegation in Congress, recent bills, discussions and every legislator. It is now
a row of tabs, each its own page: **Overview** (where the session stands, the
legislature at a glance, statewide officials, the latest three bills), **Legislature**
(state lawmakers, searchable), **Bills**, **Committees**, **Congress** (the state's
U.S. senators and representatives) and **Local** (cities we cover).

- Tabs with nothing behind them are left out rather than shown empty: territories
  have no legislature tabs, and Local appears only where we cover a city (Boston,
  under Massachusetts), so other states never show an empty "cities" tab.
- State and federal lawmakers are told apart by place, not long labels: the tabs
  read Legislature and Congress, and headings say "State legislators", "U.S. Senate"
  and "U.S. House"; each tab's footnote points to the other.

## 80. Boston committee hearings

Boston's Legistar has no committee bodies; the council's committee hearings are
filed as City Council meetings, with the committee named only in the location text
("Ways & Means Committee Hearing on Dockets #1829-1838"). The sync now reads the
committee from that text (`committeesFromLocation`, which settles spellings like
"&"/"and" and older short names on the 22 standing committees and splits joint
hearings) into `local_meetings.committees`, and keeps each meeting's agenda items
that are council matters (`local_meeting_items`). Meetings stored earlier are read
again once (`meetingsVersion`), which costs one agenda request per meeting.

Boston gets a Committees tab: upcoming hearings, every committee with its next or
last hearing, and a page per committee listing its hearings and the dockets on each
agenda. Agenda lines point at Legistar's "matters recently heard" records, whose
titles lead with procedure ("On the message and order, referred on …, Docket #1829,
to …"); pages show the docket's own title when we hold it, the cleaned line
otherwise, and link to Legistar for matters we don't keep. Legistar lists no
committee members, so the pages don't either.

## 81. On-demand cache lifetimes and the Congress.gov ceiling

Bills fetched on demand (ones we don't store) are cached 30 days when from a past
Congress and 1 hour when from the current one. Past Congresses' bills no longer
change, so a long cache serves later visitors at no cost; current bills gain actions
and cosponsors daily, so a long cache would show stale status. A current bill is
also only fetched on demand until the regular sync stores it, which soon makes the
cache moot.

The syncs' Congress.gov ceiling drops from 4,800 to 4,500 requests an hour, so the
syncs (4,500) and visitors' on-demand lookups (capped at 300) together stay under
the key's 5,000.

## 82. Worcester, the second city

Worcester is the state's second-largest city and its records are readable, though
not through Legistar, so it gets its own sources (approved by the owner):

- **PrimeGov** (worcesterma.primegov.com), the city's agenda system, has a public
  JSON feed of meetings with their agendas and minutes. `sync-worcester` keeps
  City Council and standing committee meetings hourly; boards, commissions and
  school councils on the same feed are left out. Joint meetings appear once per
  committee there and once on our pages.
- **The city's website** lists the eleven councilors (seat, email, photo) and, unlike
  Boston's Legistar, each standing committee's chair, vice-chair, members and
  description. Parsed weekly; a page that reads short (under nine councilors or
  five committees) fails the job instead of emptying the city.
- **Worcester open data** has the council district map (2020 Census, in use since
  2022), loaded in the migration, and the capital budget, which is published only
  as a PDF. The "Load Worcester budget" workflow reads it monthly with `pdftotext`,
  places amounts by column (some cells are blank, not "-"), and refuses a document
  unless every department's projects add up to its printed sub-total. The five-year
  plan's area totals are only reported: the FY26 plan prints a Facility
  Improvements total $1.4M above its own rows. FY24 and FY25 use older layouts the
  parser doesn't read; it loads the newest two years, preferring adopted to proposed.

Councilors have no numeric id, so `local_officials.id` now also allows
`{city}-{name slug}` (worcester-khrystian-king), and `person_id` is optional. The
address lookup matches any city's district map. Worcester's pages mirror Boston's
tabs (Overview, Council, Committees, Budget) and sit under Massachusetts' Local tab.
Agenda items and roll-call votes aren't in a structured form yet (agenda pages only);
311 work orders are on the open data site for a later phase.

## 83. Worcester's operating budget and project pages

- **Operating budget:** the same PDF series has an annual operating budget (455
  pages). We keep only its "Revenue Summary" and "Expenditure Summary" tables
  (24 revenue lines in six groups, 41 spending lines in three), with every column
  the book prints (FY27: FY25 actuals, FY26 budget, FY27 budget). The book prints
  these tables more than once and in parts, so the loader takes the first copy that
  reaches the grand total with every group adding up (within $10 of rounding; the
  city's FY25 City Services total is $3 off its lines). The Budget tab shows it as
  Boston's does: total and change, the property tax share, revenue by group and
  spending by line.
- **Project pages:** Worcester's PDF has no project ids, so a project is keyed by
  department and title ("public-works-resurfacing"). A program funded every year
  keeps one page, which lists each budget's amounts, and one discussion. Discussions
  reuse the `capital_project` target with the id `worcester-{slug}`.
- **Discussions in Worcester:** `worcester` is a discussion jurisdiction (with an
  optional council district, 1–5); the residency check compares the saved address's
  city with the discussion's. The admin form now defaults a capital project request
  to its city (it had defaulted Boston projects to "United States").

## 84. City keys and one set of city pages

- **Keys carry the state.** A city's key is its state and slug (`ma-boston`,
  `ma-worcester`), so two towns with one name in different states can't collide.
  The key is the `city` column on every local table, the prefix of every id that
  belongs to the city (`ma-boston-p324`, `ma-worcester-gary-rosen`,
  `ma-boston-CAR24715`), and the jurisdiction of its discussions. Migration 041
  renamed existing rows in place (foreign keys among local tables cascade on
  update) and rewrote the ids that follows, feed events and discussions point at.
  The Boston-only datasets (311, zoning, Capital Plan, operating budget) gained a
  `city` column defaulting to `ma-boston`, so every page reads by city.
- **One skeleton.** Pages live under the state: `/states/{st}/{city}/` with
  council, committees, neighborhoods, budget, councilor, committee, project and
  matter pages, built for every city in the registry (`site/src/lib/cities.ts`:
  name, council, seats, what a committee session is called, sources). Loaders
  turn each city's sources into shared shapes (`site/src/lib/city.ts`): Boston's
  line-item operating budget and Worcester's printed summary both become an
  operating summary; Boston's five-year plan and Worcester's annual budgets both
  become a list of projects. A tab and its pages exist only when the city has data
  for them; sections without data are left out rather than shown empty.
- **Old addresses** (`/boston/…`, `/worcester/…`) redirect from the 404 page,
  which already sends uncached pages to their fallbacks; Boston councilor pages
  moved from the Legistar person id (`/boston/councilors/324/`) to the id within
  the city (`…/councilors/p324/`).
- Boston's 22 standing committees are now rows in `local_committees` like
  Worcester's (without members: Legistar doesn't list them), so committees have
  one model.

## 85. Member stats are stored, not computed per read

`member_vote_stats`, `member_party_unity` and `member_cosponsor_counts` were views
over every vote position and cosponsorship. The site build reads them in pages, so
each page re-ran the whole aggregate; with a full Congress of roll calls one read
passed the anon statement timeout and failed a deploy. They are now materialized
views with unique keys, refreshed concurrently by pg_cron every 30 minutes
(`private.refresh_member_stats()`). Member pages can lag new roll calls by up to
half an hour, which the nightly rebuild absorbs anyway.

## 86. Governor's orders and the state high court (Massachusetts first)

- **Supreme Judicial Court:** from CourtListener (already a source for the U.S.
  Supreme Court), court id `mass`, decisions since January 2024 into
  `state_court_cases`. Titles, dates, citations, dissent counts and a link to the
  opinions; no opinion text. The free tier (50 requests an hour, 125 a day) is
  shared with `sync-scotus`, so `sync-state-courts` runs every three hours with at
  most eight requests (and only what the shared hourly and daily limits leave): the
  first load is a month per request, newest month first so recent decisions appear
  at once (an early version loaded oldest first and showed only early 2024 for its
  first day), then one request a run.
  More states are a line in `STATE_COURTS` and `STATE_COURT_NAMES`.
- **Governor's executive orders:** from the Trial Court Law Libraries' list on
  mass.gov (approved by the owner as a new source). mass.gov answers plain requests
  with "Not allowed", so a weekly GitHub Action reads the pages in headless Chromium:
  the two newest index pages (orders 500 and up), and each new order's page for its
  date, governor and what it revokes. It refuses a read of fewer than 20 orders
  rather than load nothing. About 150 rows; a handful a year after that.
- Each has its own state tab, Governor and Courts, listed like the Bills tab:
  searchable, filtered by year (and "With a dissent" for decisions), ten to a page, shown only when there is something
  on file, with the latest of each on the state Overview. Every order and decision
  has its own page (`states/ma/governor/635/`, `states/ma/courts/{cluster}/`) where
  people can ask for a discussion: target types `state_order` (`ma-635`) and
  `state_court_case` (`ma-{cluster id}`), migration 045. The first version's single
  `executive/` tab redirects to Governor.

## 87. Worcester's agenda items as council matters

- **Source:** PrimeGov, already approved. Agendas up to mid-2026 have an HTML
  version; later ones are PDF only (the "HTM Agenda" template is a PDF too, and the
  portal's preview needs a login), so a daily GitHub Action reads the PDF with
  `pdftotext -layout`, like the budget loader. Edge Functions can't run poppler.
- **What an item is:** numbered sections ("12. ORDERS") of lettered items ("12a."),
  with a line before a run of items saying what the council is asked to do ("9a -
  9k Refer to Traffic and Parking Committee"). Types come from the item's wording
  ("ORDER of …", "PETITION of …") or its section: orders, resolutions, petitions,
  hearings, City Manager communications, other communications, committee reports,
  ordinances ("TO BE ORDAINED"). Procedure (pledge, roll call, minutes, public
  participation, "Number Not Used") is left out.
- **Sponsors:** "ORDER of Councilor A and Councilor B - …", "Councilor A on behalf
  of …" or a closing "(Rivera)". Full names give the official id directly (former
  councilors too); a surname must match exactly one councilor.
- **Ids and carried items:** a matter is `ma-worcester-{meeting id × 1000 +
  position}`, cited as "Item 12a, Oct 6, 2026". Orders, resolutions, ordinances and
  communications are held and tabled from meeting to meeting with the same wording;
  a later appearance updates the first matter (one page, one discussion) and adds an
  action, so its page shows each meeting it was on. Hearings and petitions repeat
  wording for separate requests, so each stays its own matter.
- **Not yet:** outcomes (adopted, referred, filed) are in the minutes PDFs. The list
  shows what the council was asked to do; reading minutes is a later step.
- A city now says how its matters are cited (`docketPrefix`), what its record link
  is called and what its Council tab calls them; the consent-agenda toggle shows only
  where that type exists.


## 88. Yours first, and how much of each state we hold

- **Your representatives, then what you follow, at the top of each list.** For a
  signed-in visitor with saved districts (Find my reps), a state's Congress tab, its
  Legislature tab and a city's Council tab open with their own members, legislators
  and councilors (district and at-large), then anyone else on the page they follow.
  The federal bills page, a state's Bills tab and a city's Council tab open with the
  bills or council items they follow. All of it is read in the browser from the
  visitor's own profile and follows (RLS), and nothing shows when signed out. The
  members page already opens with the saved representatives (Find my reps), so its
  "Members you follow" leaves those out.
- **Coverage.** Open States' bill listing reports how many bills a session has
  (`pagination.total_items`). sync-state records it on the first page of a state's
  first load, then about weekly with one request per state (about seven a day across
  states, from the same daily budget), in `state_bill_counts`; the
  `state_bill_coverage` view adds how many we hold. A state's Bills tab shows "X of Y
  bills in the session on file", and the states index the total with a table by
  state. Only the current session is counted: earlier sessions aren't loaded.

## 89. Supabase egress: fewer, smaller builds

The free plan includes 5 GB of egress a month. A production site build downloaded
about 57 MB of JSON (about a sixth of that on the wire: PostgREST responses are
gzipped), and a push could build the site twice: once on the push and again after
Deploy Supabase. Now:

- A push that touches `supabase/`, `packages/` or the Supabase workflow builds only
  after Deploy Supabase finishes; docs, scripts and loader workflows don't build.
- The full bill list reads list columns only; summaries, links and the other page
  fields are read just for bills with their own page (bills 20 → 13 MB).
- A councilor's page reads light rows for all their matters and full rows only for
  the ten it shows (council sponsors 4.7 → 1.5 MB).

A build is now about 47 MB uncompressed. The nightly rebuild plus a few deploys a day
stays well within the allowance; Supabase's usage page splits egress by service if it
climbs.

## 90. What a court decision is about

CourtListener's search results don't describe a case, but Massachusetts opinions
open with the reporter's subject keywords ("Homicide. Evidence, Hearsay.") and the
opinion's first paragraph says what the appeal is about. `sync-state-courts` reads
each decision's opinion text once (up to six a run, newest first, from whatever is
left of the shared CourtListener budget) and keeps only those two pieces
(`keywords`, `opening`); `text_checked_at` marks it read. The Courts list shows the
subjects under each case name (and searches them); a decision's page shows them as
chips with the opening paragraph. The parser follows the slip-opinion layout and
gives null for text that doesn't match (rescripts, damaged text).

## 91. What a governor's order says

Each order's page on mass.gov carries its Massachusetts Register number and its
text: the WHEREAS clauses, then what the governor orders, often in numbered
sections. The Load governor orders workflow already opens each order's page, so it
now keeps the register number and the text (`register`, `body`; migration 048) and
re-opens orders stored without them once. The order's page on the site shows "What
it orders" (the first three sections, the rest folded) and "Why, in the order's
words" (the first three WHEREAS clauses). Orders that only amend another have no
WHEREAS; their text is what follows the header fields. About 150 orders of a few KB
each.
