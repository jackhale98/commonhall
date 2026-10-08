# Civic Tracker

**See what your government is doing, from Congress to City Hall.**

Civic Tracker is a free, nonpartisan, open-source website for following the
U.S. Congress, state legislatures and the Boston City Council. Look up bills and
votes in plain language, find out who represents you, follow what you care
about, and take part in moderated public discussions.

**Live site:** https://jackhale98.github.io/opencongress/

> **Status:** the site is running as a **demo** built from a small sample of real
> data while its database is being connected. Accounts, following, the feed and
> Find my reps switch on once it is. See [Project status](#project-status).

## Contents

- [What you can do](#what-you-can-do)
- [Coverage and data sources](#coverage-and-data-sources)
- [How it works](#how-it-works)
- [Privacy and principles](#privacy-and-principles)
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

**Massachusetts** (covered in full)

- State legislators by chamber, with a party chart of each chamber.
- State bills, with their own pages for bills that are advancing, and links to the
  full text on malegislature.gov.

**Boston City Council**

- All 13 councilors, with a clickable map of the nine council districts.
- Ordinances, orders, resolutions and hearing orders, with sponsors and history.
- Upcoming and recent council meetings, with agendas and minutes.

**Every state**

- A state map with each state's members of Congress, state legislators and recent
  state bills.

**For you**

- **Find my reps:** enter an address to get your members of Congress, state
  legislators and, in Boston, your district and at-large councilors.
- **Follow** any bill, council matter, legislator or discussion and see everything
  that changed in one **feed**. Sign-in is by emailed link; there are no passwords.
- **Discussions:** structured public conversations (powered by
  [Pol.is](https://pol.is)) on selected bills and council matters. You vote on short
  statements and add your own; the results show where people agree and where
  they divide. You can ask for a discussion on any bill or matter.

**At a glance:** charts throughout the site show the make-up of each chamber,
where bills stand, the most active topics, and how votes split.

## Coverage and data sources

All data comes from official or public-domain sources and refreshes
automatically.

| What | Source | Refreshed |
| --- | --- | --- |
| Federal bills, actions, summaries, members | [Congress.gov API](https://api.congress.gov/) | every 10 minutes |
| House and Senate roll-call votes | Congress.gov and [senate.gov](https://www.senate.gov/legislative/votes.htm) | every 10 minutes |
| Member contact details and IDs | [congress-legislators](https://github.com/unitedstates/congress-legislators) (public domain) | daily |
| Member photos | Congress.gov, then [unitedstates/images](https://github.com/unitedstates/images) (public domain), loaded by your browser | — |
| State legislators and bills | [Open States](https://openstates.org/) (CC0) | nightly, Massachusetts first |
| Boston City Council | [Boston Legistar](https://boston.legistar.com/) | nightly |
| Boston council districts | [Analyze Boston](https://data.boston.gov/) | on redistricting |
| Address lookups | [U.S. Census Geocoder](https://geocoding.geo.census.gov/) | per lookup |
| Discussions | [Pol.is](https://pol.is) | live |

Known gaps: Boston publishes council roll-call votes only in meeting minutes, not
in Legistar, so individual councilors' votes are not shown. Bills from older
Congresses load on demand.

## How it works

```
Congress.gov · senate.gov · congress-legislators · Open States · Census · Boston Legistar
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
| `sync-state` | nightly | State bills and legislators, Massachusetts first |
| `sync-boston` | nightly | Council matters, sponsors, meetings and councilors |
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

Full details are on the site's [privacy page](https://jackhale98.github.io/opencongress/privacy/)
and [discussion rules](https://jackhale98.github.io/opencongress/moderation/).

## Project status

| Area | Status |
| --- | --- |
| Website, charts, Congress, states and Boston pages | Live (demo data) |
| Database, accounts, following, feed, Find my reps | Ready; switches on when Supabase is connected |
| Massachusetts bills | Ready; arrives with the first nightly sync once the Open States key is set |
| Discussions | Example discussions open as a preview; pilot topics to be chosen |

To finish connecting the live site, follow the
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
| [Design decisions](docs/decisions.md) | Why things work the way they do |
| [Contributing](CONTRIBUTING.md) | Local setup, checks and project rules |

## License

[MIT](LICENSE). Congress.gov, senate.gov and congress-legislators data are in the
public domain; Open States data is CC0; Boston data is published by the City of
Boston.
