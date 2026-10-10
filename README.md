# CommonHall

**See what your government is doing, from Congress to City Hall.**

CommonHall is a free, nonpartisan, open-source website for following the
U.S. Congress, state legislatures and the Boston City Council. Look up bills and
votes in plain language, find out who represents you, follow what you care
about, and take part in moderated public discussions.

**Live site:** https://commonhall.org/

> **Status:** live data is loading. The database is connected and syncing on
> schedule, and the first full load of the current Congress (about 15,000 bills
> and every roll call) is still filling in, newest first. See
> [Project status](#project-status).

## Contents

- [What you can do](#what-you-can-do)
- [Coverage and data sources](#coverage-and-data-sources)
- [How it works](#how-it-works)
- [Privacy and principles](#privacy-and-principles)
- [Running discussions](#running-discussions)
- [Project status](#project-status)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

## What you can do

**Congress**

- Browse and search every bill and resolution in the current Congress, filter by
  chamber, status, policy area, sponsor's party or whether it has a discussion.
- Read a bill's plain status tracker, summary, full action history, sponsor,
  cosponsors (with a party breakdown) and related roll-call votes.
- See every roll-call vote: the result, a party-by-party breakdown and how each
  member voted. The votes page highlights the closest votes.
- Look up any member of Congress: photo, contact details, sponsored bills, recent
  votes, and how often they vote and vote with their party.
- Browse every committee and subcommittee: chair and ranking member, the full
  roster by party, the bills sent to it (still in committee or reported out),
  and upcoming and recent hearings and markups with witnesses and video. Member
  pages list each member's committee seats; bill pages list the committees a bill
  went to.
- See where each member's campaign money comes from: totals raised and spent,
  small versus large donors, PACs, in-state versus out-of-state money, and the
  employers of their largest donors.

**The executive branch**

- Executive orders as published in the Federal Register, with which earlier
  orders each one revokes, and counts per year and per presidential term.
- Every nomination the President sends to the Senate and where it stands, from
  committee to confirmation, linked to the Senate's recorded vote.

**The Supreme Court**

- Decisions from the last five terms, newest first, with the full opinions on
  CourtListener, the case's docket on supremecourt.gov, concurring and dissenting
  opinions where they are listed separately, and decisions per term.
- What each case is about: its topic (Supreme Court Database) and the background
  from the Court's official syllabus, word for word; searchable and filterable.

**Massachusetts** (the featured state)

- State legislators, searchable by name or district, with a party chart of each chamber.
- State bills, with their own pages for bills that are advancing, and links to the
  full text on malegislature.gov.
- The governor's executive orders and Supreme Judicial Court decisions (a
  "Governor & courts" tab).

**Cities** (`/states/ma/boston/`, `/states/ma/worcester/`): one set of pages for
every city, filled from whatever the city publishes. Tabs (Overview, Council,
Committees, Neighborhoods, Budget) appear only when there is data behind them; a
new city is a sync plus an entry in `site/src/lib/cities.ts`, no page code.

**Boston** (tabs: Overview, Council, Committees, Neighborhoods, Budget)

- All 13 councilors, with a clickable map of the nine council districts.
- Ordinances, orders and hearing orders, with sponsors and history; consent-agenda
  resolutions (congratulations and commendations) are hidden until asked for.
- Upcoming and recent council meetings, with agendas and minutes.
- 311 requests by council district: how many, the share closed on time, typical
  time to close and the most common requests (summaries only).
- Upcoming Zoning Board of Appeal hearings, searchable by street; the last year's
  decisions as totals by neighborhood (no archive of past cases by address).
- The city budget: the operating budget by department and revenue by source, and
  the five-year Capital Plan by department, neighborhood and project, with a page
  per project where people can ask for a discussion.

**Worcester** (tabs: Overview, Council, Committees, Budget)

- All 11 councilors, the district map, standing committees with members.
- Council and committee meetings with agendas and minutes.
- Every item on the council's agendas (orders, petitions, resolutions, City
  Manager communications, committee reports, ordinances), searchable, with
  sponsors and what the council was asked to do; held items keep one page.
- The operating budget summary and the capital budget, with a page per project.

**Every state**

- A state map with each state's members of Congress, state legislators and recent
  state bills.

**For you**

- **Find my reps:** enter an address to get your members of Congress, state
  legislators and, in Boston, your district and at-large councilors.
- **Follow** any bill, council matter, legislator or discussion and see everything
  that changed in one **feed**. Sign-in is by emailed link; there are no passwords.
- **Discussions:** structured public conversations (powered by
  [Pol.is](https://pol.is)) on Boston council matters, Massachusetts and federal
  bills, executive orders and Supreme Court decisions, listed local first. You vote
  on short statements and add your own; the results show where people agree and
  where they divide. You can ask for a discussion from any of those pages.

**At a glance:** charts throughout the site show the make-up of each chamber,
where bills stand, the most active topics, and how votes split.

## Coverage and data sources

All data comes from official or public-domain sources and refreshes
automatically.

| What | Source | Refreshed |
| --- | --- | --- |
| Federal bills, actions, summaries, members | [Congress.gov API](https://api.congress.gov/) | every 10 minutes |
| House and Senate roll-call votes | Congress.gov and [senate.gov](https://www.senate.gov/legislative/votes.htm) | every 10 minutes |
| Committees and rosters | congress-legislators | daily |
| Bill referrals, hearings and markups | Congress.gov | hourly |
| Member contact details and IDs | [congress-legislators](https://github.com/unitedstates/congress-legislators) (public domain) | daily |
| Executive orders | [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1) | hourly |
| Nominations | Congress.gov | hourly |
| Supreme Court decisions | [CourtListener](https://www.courtlistener.com/) (Free Law Project) | hourly |
| Massachusetts Supreme Judicial Court decisions | [CourtListener](https://www.courtlistener.com/) | every 3 hours |
| Massachusetts governor's executive orders | [mass.gov](https://www.mass.gov/massachusetts-executive-orders) (Trial Court Law Libraries' list) | weekly |
| Campaign finance | [OpenFEC](https://api.open.fec.gov/developers/) | weekly per member |
| Member photos | Congress.gov, then [unitedstates/images](https://github.com/unitedstates/images) (public domain), loaded by your browser | — |
| State bills | [Open States](https://openstates.org/) (CC0) | hourly within a daily request budget, Massachusetts first |
| State legislators and committees | [openstates/people](https://github.com/openstates/people) (CC0) | weekly |
| Boston City Council | [Boston Legistar](https://boston.legistar.com/) | every 15 minutes |
| Boston council districts | [Analyze Boston](https://data.boston.gov/) | on redistricting |
| Boston 311 request summaries | [Analyze Boston](https://data.boston.gov/dataset/311-service-requests) (both 311 systems) | daily |
| Boston Zoning Board of Appeal | [Analyze Boston](https://data.boston.gov/dataset/zoning-board-of-appeal-tracker) | daily |
| Boston Capital Plan | [Analyze Boston](https://data.boston.gov/dataset/capital-budget) | weekly |
| Boston operating and revenue budgets | [Analyze Boston](https://data.boston.gov/dataset/operating-budget) | weekly |
| Worcester councilors and standing committees | [worcesterma.gov](https://www.worcesterma.gov/city-council/councilors) | weekly |
| Worcester council and committee meetings, agendas, minutes | [PrimeGov](https://worcesterma.primegov.com/public/portal) | hourly |
| Worcester council agenda items | [PrimeGov](https://worcesterma.primegov.com/public/portal) agendas (HTML or PDF) | daily |
| Worcester council districts | [Worcester open data](https://opendata.worcesterma.gov/) (2020 Census map) | on redistricting |
| Worcester capital and operating budgets | [Worcester open data](https://opendata.worcesterma.gov/) (annual PDFs) | monthly check |
| Address lookups | [U.S. Census Geocoder](https://geocoding.geo.census.gov/) | per lookup |
| Discussions | [Pol.is](https://pol.is) | live |

Known gaps: Boston publishes council roll-call votes only in meeting minutes, not
in Legistar, so individual councilors' votes are not shown. Bills from older
Congresses load on demand.

## How it works

```
Congress.gov · senate.gov · congress-legislators · Open States · Census · Boston Legistar · Analyze Boston · Worcester PrimeGov · Worcester open data
                                   │
          Scheduled jobs (Supabase Edge Functions, run by pg_cron)
                                   │  API keys stay here
                                   ▼
                    Supabase Postgres (row-level security everywhere)
                      │                                    │
      Nightly site build (GitHub Actions)       Your browser (public, read-only key)
                      │                                    │
          Static website on GitHub Pages  ◄────────────────┘  live updates, follows, feed
```

- **A fast static site.** Pages are built ahead of time and served by GitHub
  Pages. Members, councilors, discussions and notable items (bills past
  committee, advancing Massachusetts bills, anything followed or discussed) get
  their own prebuilt pages; everything else loads on request at the same kind of
  link, so every bill still has a shareable page.
- **Always current.** Each page fetches its latest status and actions when you
  open it, so changes appear without waiting for the nightly rebuild.
- **Scheduled sync jobs** fetch only what changed since their last run, stay within
  each source's request limits, and can stop and resume safely.
- **Security by default.** API keys never reach the browser. The browser uses a
  public read-only key, and row-level security limits every table so people can
  only read public data and their own account.
- **Free to run.** Everything fits the free tiers of GitHub and Supabase.

| Scheduled job | Runs | What it does |
| --- | --- | --- |
| `sync-federal` | every 10 minutes | New roll-call votes and changed bills; writes feed events |
| `sync-members` | daily | Members of Congress |
| `sync-state` | hourly (daily Open States budget) | State bills, Massachusetts first |
| `sync-boston` | every 15 minutes | Council meetings, matters, sponsors and councilors |
| `sync-worcester` | hourly | Worcester council and committee meetings; councilors and committee members weekly |
| `sync-state-courts` | every 3 hours | Massachusetts Supreme Judicial Court decisions from CourtListener (shares the free tier with `sync-scotus`) |
| Load Worcester agendas (GitHub Action) | daily | The items on Worcester City Council agendas from PrimeGov (HTML or PDF), as council matters with sponsors |
| Load governor orders (GitHub Action) | weekly | Massachusetts governors' executive orders from mass.gov, read in a headless browser |
| Load Worcester budget (GitHub Action) | monthly | Worcester's capital budget and operating revenue and spending summaries from the city's PDFs, checked against their printed totals |
| Load state people and committees (GitHub Action) | weekly | Legislators' offices, phones and links; every state's committees and members |
| Nightly rebuild | daily | Rebuilds the website so new notable items get their own page |

The reasoning behind the main design choices is recorded in
[docs/decisions.md](docs/decisions.md).

## Privacy and principles

- **Nonpartisan.** Neutral wording, the same treatment for every party, and party
  colours used only to show data.
- **No ads, no tracking.** The site has no analytics or tracking scripts.
- **Minimal data.** An account stores your email, what you follow and, only if you
  choose to save it, your matched address and districts. Delete any of it, or your
  whole account, at any time.
- **Discussions stay anonymous.** Pol.is receives a random ID for you and nothing
  else: never your name, email, account ID or address.

Full details are on the site's [privacy page](https://commonhall.org/privacy/)
and [discussion rules](https://commonhall.org/moderation/).

## Running discussions

Discussions are [Pol.is](https://pol.is) polls embedded in the site. Maintainers
create them from the site; Pol.is creates the poll the first time its page loads.

**One-time setup**

1. Set the repository variable `PUBLIC_POLIS_SITE_ID` (Pol.is → **Integrate**).
2. Sign in to the site once, then make yourself a maintainer in the Supabase SQL
   editor:

   ```sql
   insert into public.admins (user_id, role)
   select id, 'admin' from auth.users where email = 'you@example.org';
   ```

**Create a discussion**

1. Sign in and open **Admin: discussions** (in the footer and on the Account page).
2. Fill in the form: a short **id** (it becomes the address and the Pol.is page
   id, and cannot change), a neutral question as the **title**, a one-paragraph
   **prompt**, the **jurisdiction**, and what it is **about** (a bill, Massachusetts
   bill, council matter, executive order or Supreme Court decision).
3. Save it as a **draft** and open its page from the admin list while signed in to
   Pol.is. That first load creates the poll in your Pol.is account.
4. In the Pol.is dashboard, turn on **strict moderation** and add 6–10 balanced
   **seed statements**.
5. Set the status to **open**. It appears in the discussion lists and on the
   item's page straight away; the next build gives it its own prerendered page.

**When someone asks for one**

Anyone can press "Ask for a public discussion" on an item's page, signed in or
not. The admin page opens with **Waiting for a discussion**: requested items that
have no discussion yet, most requested first (never who asked). **Start a
discussion** fills in the form for one. Once a discussion exists for an item (even
a draft), its requests move to the folded **Requests already covered** list, and
closed discussions are folded away too.

**While it runs**

- Moderate new statements in Pol.is at least daily under the published
  [discussion rules](https://commonhall.org/moderation/):
  accept or reject, never edit.
- Set the status to **closed** to stop voting; results stay readable. Pol.is's
  **Report** and **Export** give a shareable report and CSV files.
- Anyone can vote and add statements without an account for now. Set the
  repository variable `PUBLIC_OPEN_PARTICIPATION=false` and redeploy to require
  sign-in and enforce "residents only".

The full guide is [docs/discussions.md](docs/discussions.md).

## Project status

| Area | Status |
| --- | --- |
| Website, charts, Congress, states and Boston pages | Live |
| Database and scheduled syncs | Live: bills and votes every 10 minutes, members daily, states and Boston nightly |
| Federal bills and roll-call votes | Loading: the first full load of the current Congress takes about a day; recently active bills and the newest votes arrive first |
| Boston council districts | Loaded |
| Campaign finance (FEC) | Ready; fills in over the first week after deploy (about 535 members, refreshed weekly) |
| Accounts, following, feed, Find my reps | Ready; sign-in needs an email (SMTP) provider in Supabase Auth |
| Massachusetts bills | Arriving with the nightly Open States sync |
| Discussions | Example discussions open as a preview; pilot topics to be chosen |
| Committees, rosters, hearings | Ready; rosters load on the first hourly run, referrals fill in as bills load |
| Executive orders and nominations | Ready; load on the first hourly run after deploy |
| Supreme Court | Ready; loads on the first hourly run after deploy (needs `COURTLISTENER_TOKEN`) |

The site is static and rebuilds nightly (and on every deploy), so new data shows
up on pages the next morning; bill pages also fetch their latest status live.

To set up your own copy, follow the
[deployment guide](docs/deployment.md).

## Development

Requirements: Node 22 and Docker. No API keys are needed: the local database is
loaded with real sample data.

```sh
npm install
npm run db:start            # local Supabase in Docker
npm run db:reset            # create the database and load the sample data
npx supabase status         # shows the local URL and keys
cp .env.example site/.env   # set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY
npm run dev                 # http://localhost:4321
```

Checks (CI runs the same): `npm run lint`, `npm run typecheck`,
`npm test -- --project unit` and `npm run test:db`. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow and project rules.

| Path | What |
| --- | --- |
| `site/` | The website (Astro, with small Preact components) |
| `supabase/` | Database migrations, Edge Functions, tests and sample data |
| `packages/congress-client/` | Typed clients for each data source, tested against recorded responses |
| `packages/sync/` | The sync jobs, shared by the Edge Functions and scripts |
| `scripts/` | Backfill, sample-data and verification scripts |
| `docs/` | Guides and design decisions |

## Documentation

| Guide | For |
| --- | --- |
| [Deployment and operations](docs/deployment.md) | Connecting Supabase and GitHub, schedules, sign-in, troubleshooting |
| [Configuration reference](docs/configuration.md) | Every secret, variable and setting in one place |
| [Discussions](docs/discussions.md) | Setting up Pol.is, creating and moderating discussions, privacy rules |
| [Custom domain and repository rename](docs/domain-and-rename.md) | Switching to your own domain or renaming the repo without breaking sign-in, links or the backfill |
| [Design decisions](docs/decisions.md) | Why things work the way they do |
| [Contributing](CONTRIBUTING.md) | Local setup, checks and project rules |

## License

[MIT](LICENSE). Congress.gov, senate.gov and congress-legislators data are in the
public domain; Open States data is CC0; Boston data is published by the City of
Boston.
