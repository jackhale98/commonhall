# CommonHall — Agent Rules

CommonHall is a free, nonpartisan, open-source site for following government from Congress to City Hall: an Astro static site on GitHub Pages, Supabase Postgres with row-level security, Edge Functions run by pg_cron, and GitHub Actions loaders. See `README.md`, `CONTRIBUTING.md` and `docs/decisions.md`.

This project is built mostly by AI agents. A full review in October 2026 found the code careful within each file, with problems at the seams between files: an alarm that no check reads, a deletion that the follows table doesn't know about, docs that drifted from the code. Most of the rules below exist to catch that.

## Before you start

- Read the whole file or section you are about to change, not just the lines around your edit.
- When you change how something behaves, search for every other place that depends on it (migrations, `packages/sync`, `supabase/functions`, `scripts/`, `site/src`, docs, workflows) and check each one.
- Check `docs/decisions.md` for an existing decision before changing a design. If you reverse one, add a new entry saying why.

## Non-negotiable rules

1. **Row-level security on every table in `public`**, with write grants revoked from `anon` and `authenticated` on public-data tables. Views are `security_invoker`. `SECURITY DEFINER` functions set `search_path = ''` and check `is_admin()` themselves when they need it. A test enforces RLS; never weaken it.
2. **No secrets in the browser.** Only `PUBLIC_*` variables reach the site. Never reference a service role key or API key in `site/`.
3. **Only `http:` and `https:` URLs.** Any URL from upstream data (Open States, Legistar, PrimeGov, CivicClerk, Congress.gov, CourtListener, city sites) goes through the shared `safeUrl()` helper at sync time and again at render. Never put an unchecked upstream value into `href` or `src`. Never render upstream HTML with `set:html`, `innerHTML` or `dangerouslySetInnerHTML`.
4. **Scheduled jobs are idempotent and resumable.** A crash mid-run must be safe to rerun. Use `runJob`, `upsertIfChanged` and `HttpClient`; respect the shared request budgets.
5. **Never silently orphan user data.** Before any `delete` or cascade on data people can follow or discuss (bills, matters, orders, cases, discussions), check `follows`, `discussions` and `discussion_requests`. Keep or archive followed and discussed items instead of deleting them.
6. **Every failure must reach a check someone reads.** A new cron job, Edge Function or loader is registered in `private.job_schedule` so `health_rows()` and `/status/` see it. Don't `raise exception` after writing a status row in the same transaction: the raise rolls the write back. Record the error and return instead.
7. **Anything public and writable is rate-limited per client**, not just site-wide, and has a retention job that purges old rows.
8. **Pin versions.** GitHub Actions are pinned to commit SHAs; the Supabase CLI and other tools to fixed versions. Secrets are set only on the steps that need them, not at job level. Workflow inputs reach shell commands through `env:` and are quoted.
9. **Ask before** adding a paid service, a new upstream data source, or a third-party script in the site.

## Data sources and parsers

- Verify field names against a real recorded response (and the OpenAPI document for Congress.gov) before writing a parser. Save the response as a test fixture.
- Fail loudly when an upstream changes shape: keep the field-shape and minimum-count checks, and add them to any new parser.
- Shared helpers live in one place in `packages/sync`: HTTP fetching (`HttpClient`, with a status check on every response), PDF text extraction, user agent, URL checks. Don't copy them into scripts.
- Loader logic in `scripts/` that writes to the database belongs in `packages/sync` with DB tests; the script should only be a thin entry point.
- Quote official text (syllabi, summaries, orders) word for word from the source. Never write your own summary of a bill, order or ruling and present it as official.

## Growth and free tiers

The site must stay within the free tiers of GitHub and Supabase. Before adding data or prebuilt pages, estimate:
- **Database size** against 500 MB (the size guard warns at 400 MB). Add retention for anything that grows with time or with users.
- **Built site size** against the deploy guard. Anything users can trigger, such as follows, must not grow the number of prebuilt pages without a cap.
- **Egress:** browser queries use explicit column lists, limits, indexed filters, and estimated rather than exact counts for search. Add a `pg_trgm` or full-text index before adding a substring search.
- **Edge Function CPU time:** heavy HTML, XML or PDF parsing belongs in a GitHub Actions loader, not an Edge Function.

## Tests and checks

Run before finishing any task (CI runs the same):

```sh
npm run lint
npm run check:jobs
npm run typecheck
npm test -- --project unit
npm run test:db
(cd supabase/functions && deno check */index.ts)
```

- A new migration that rewrites existing rows (for example, clearing a `*_checked_at` column) states in its header how many upstream requests it will trigger against which budget.
- A new sync path or loader gets a test against recorded fixtures.

## Docs stay in step with code

- A change that alters behavior updates `README.md` and `docs/` in the same commit: the sources table, the scheduled jobs table, the status table and any refresh frequencies it mentions.
- Edit the existing paragraph or table row; don't add a second version beside it. After editing, reread the whole section for duplicates and missing blank lines before headings.
- New `docs/decisions.md` entries are appended at the end with the next number.
- The project is named CommonHall everywhere. Don't reintroduce "civic-tracker" or "Civic Tracker".

## Res Publica

[Res Publica](https://library.commonhall.org) is a separate repo: a library of founding texts and landmark Supreme Court cases. The two sites link by shared IDs: Supreme Court cases by CourtListener cluster ID, and Constitution clauses by Res Publica refs such as `Constitution.1.8.3`. Don't copy Res Publica data into CommonHall's database; read its published static index at build time.
