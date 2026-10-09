# Moving to a custom domain and renaming the repository

This guide covers two changes that can be made separately or together:

- **A. Serving the site from your own domain** instead of
  `https://jackhale98.github.io/opencongress/`.
- **B. Renaming the GitHub repository** (`jackhale98/opencongress` → a new name).

Nothing in the code needs to change for either: the site build reads its address
and base path from GitHub Pages at build time, and sign-in links are built from
the address the visitor is on. Everything below is settings, done in order.

## Contents

- [Recommended order](#recommended-order)
- [Before you start](#before-you-start)
- [A. Custom domain](#a-custom-domain)
- [B. Repository rename](#b-repository-rename)
- [Background jobs during the change](#background-jobs-during-the-change)
- [Checks afterwards](#checks-afterwards)
- [Undoing a change](#undoing-a-change)
- [Where each setting lives](#where-each-setting-lives)

## Recommended order

1. **Custom domain first.** With a custom domain the site is served at the domain's
   root, with no repository name in the path, so a later rename changes nothing
   visitors can see.
2. **Rename afterwards**, once the domain has worked for a day or two.

Renaming while still on `github.io` changes the site's address from
`jackhale98.github.io/opencongress/` to `jackhale98.github.io/<new-name>/`, and
GitHub does **not** redirect the old Pages path after a rename, so shared links,
bookmarks and search results to the old path stop working. Avoid that order unless
you accept those broken links.

Do both at a quiet time (for example a weekend morning US time): the site may show
unstyled pages for a few minutes between a settings change and the rebuild that
follows it.

## Before you start

- [ ] **Decide the address.** A subdomain (`civic.example.org`) is simplest. A bare
      domain (`example.org`) also works; then also set up `www`.
- [ ] **Check the backfill.** Actions → **Backfill**: note whether a run is in
      progress. It is safe to continue (see
      [Background jobs](#background-jobs-during-the-change)), but write down the
      latest run so you can confirm the chain continued.
- [ ] **Have access ready:** your domain registrar's DNS settings, the GitHub repo's
      Settings (admin), the Supabase dashboard (Authentication and Edge Functions),
      and your email (SMTP) provider if you want sign-in mail sent from the new domain.
- [ ] **Know the current values** (for rollback): Supabase → Authentication → URL
      Configuration (Site URL, Redirect URLs) and Edge Functions → Secrets →
      `SITE_ORIGINS`.

## A. Custom domain

### A1. DNS (at the registrar)

| You want | Records |
| --- | --- |
| A subdomain, e.g. `civic.example.org` | `CNAME civic → jackhale98.github.io` |
| A bare domain, e.g. `example.org` | `A @ → 185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; optionally `AAAA @ → 2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`; and `CNAME www → jackhale98.github.io` |

Remove any other `A`, `AAAA` or `CNAME` records for the same name (for example a
registrar "parking" record). DNS changes can take from minutes to a few hours; check
with `dig civic.example.org +short` until it shows GitHub's addresses.

**Cloudflare DNS:** set these records to **DNS only** (grey cloud), not Proxied.
Behind the proxy the domain resolves to Cloudflare's addresses, so GitHub reports
the DNS as wrong and cannot issue the HTTPS certificate. If you later turn the
proxy on, first wait for the certificate and **Enforce HTTPS**, and set Cloudflare
**SSL/TLS** to **Full (strict)**; if a certificate renewal fails, switch back to
DNS only until it renews.

**Verify the domain with GitHub** (recommended, prevents anyone else from claiming
it for their own Pages site): your GitHub profile → **Settings → Pages → Add a
domain**, add the TXT record it shows, then **Verify**.

### A2. GitHub Pages

1. Repo → **Settings → Pages → Custom domain**: enter the domain, **Save**. The
   site deploys through Actions, so no `CNAME` file is needed in the repository.
2. Wait for the DNS check to pass, then tick **Enforce HTTPS**. The certificate can
   take up to about an hour; until then HTTPS may show a warning.
3. **Immediately run Actions → Deploy site → Run workflow** (branch `main`). The
   build already on the live site expects the `/opencongress/` path; on the new
   domain its pages would load without styles or working links until this rebuild
   sets the base path to `/`. The rebuild also updates canonical URLs.

From now on, `https://jackhale98.github.io/opencongress/...` redirects to the same
page on the new domain, so existing links keep working.

### A3. Supabase

1. **Authentication → URL Configuration**
   - **Site URL:** `https://<your-domain>/`
   - **Redirect URLs:** add `https://<your-domain>/account/`. **Keep** the old
     `https://jackhale98.github.io/opencongress/account/` for at least two weeks:
     sign-in emails already sent point there, and GitHub forwards them.
2. **Edge Functions → Secrets → `SITE_ORIGINS`:** add the new origin, keeping the
   old one, e.g. `https://jackhale98.github.io,https://<your-domain>`. Without it,
   Find my reps, account deletion and loading older bills on demand fail on the
   new domain with a cross-origin error. (Origins have no path: no `/opencongress/`, no trailing slash.)
3. **Email (optional):** to send sign-in mail from the new domain, verify it with
   your SMTP provider (SPF and DKIM records; see
   [Email for sign-in](deployment.md#email-for-sign-in-smtp)) and change the sender
   address under Authentication → Emails → SMTP Settings. Not required: mail keeps
   working from the current sender.

Nothing else in Supabase depends on the site's address: the database, scheduled
jobs, function code and API keys are unchanged.

### A4. Pol.is

Nothing to change. Conversations are tied to the site id and each discussion's id,
not to the address, so votes and statements carry over. Open one discussion after
the switch to confirm the poll loads; if Pol.is shows a domain message, add the
domain on its **Integrate** page.

### A5. Repository text (cosmetic)

Ask a maintainer (or Claude) to replace `jackhale98.github.io/opencongress` in
`README.md` (the live-site, privacy and discussion-rules links). They keep working
through the redirect but should show the real address.

### What visitors notice

- Old links redirect to the new domain.
- **Everyone signs in again once.** Browsers keep sign-ins, the theme choice and the
  anonymous "I asked for a discussion" marker per address. Accounts, follows, saved
  addresses and feeds are in the database and are unaffected.
- Someone who asked for a discussion while signed out can ask once more on the new
  domain (a small bump in that item's request count).

## B. Repository rename

### B1. What moves with the repository automatically

- Secrets, variables, environments (including `github-pages`), branch rules, Pages
  settings and the custom domain.
- Workflows and their schedules (Nightly rebuild), and the `workflow_run` link from
  Deploy Supabase to Deploy site (it is by workflow name, not repository).
- Issues, pull requests and history. `github.com/jackhale98/opencongress` and
  `git clone`/`git push` to the old URL redirect to the new name, **as long as no new
  repository is created with the old name**.

### B2. Rename

1. Repo → **Settings → General → Repository name** → **Rename**.
2. **Run Actions → Deploy site.** With a custom domain this only refreshes the build.
   Without one, it is required at once: the live build points at the old path.
3. **Without a custom domain only:** Supabase → Authentication → URL Configuration:
   set **Site URL** to `https://jackhale98.github.io/<new-name>/` and add
   `https://jackhale98.github.io/<new-name>/account/` to Redirect URLs (keep the old
   one for a while). `SITE_ORIGINS` stays the same (the origin has no path).

### B3. Clones and tools

- Local clones keep working through the redirect; to tidy up:
  `git remote set-url origin https://github.com/jackhale98/<new-name>.git`.
- Claude Code sessions are given access to a repository by name. If a session can no
  longer push, re-add the renamed repository for the Claude GitHub app.

### B4. Repository text (cosmetic)

Replace the old name in: the footer's "Source code" link
(`site/src/layouts/Base.astro`), the user agent sent to data providers
(`packages/congress-client/src/http.ts`, so providers can find the project), and,
if still on `github.io`, the README links. Local-only defaults that use
`/opencongress/` as a path (`supabase/config.toml` redirect URL,
`scripts/check-polis-privacy.ts`, `docs/discussions.md`) can be updated for tidiness;
they do not affect the live site.

## Background jobs during the change

**Scheduled sync jobs** (bills, votes, members, finance, executive orders, the
Court, committees, Massachusetts, Boston) run inside Supabase with pg_cron. They do
not depend on the site's address or the repository name and keep running through
both changes.

**The backfill** runs in GitHub Actions in chained runs of about 5.5 hours: when a
run finishes before the load is done, it starts the next run itself, up to
`max_chain` more times.

- **Progress is stored in the database** (`sync_state`, job `backfill-federal`), not in
  GitHub. Any new run continues where the last one stopped.
- **A rename during a run is safe.** The running job keeps going. When it starts the
  next run, it looks the repository up by its permanent id, so it starts the run
  under the new name.
- **If the chain ever stops** (a rename at an unlucky moment, `max_chain` reached, a
  failed run): Actions → **Backfill** → **Run workflow** on `main` with
  **Start over unticked** (`reset` off). It resumes from the saved cursor. Ticking
  "Start over" clears the cursor and reloads everything from the beginning; never
  tick it to recover.
- **A domain change does not touch the backfill**: it talks to the database and
  Congress.gov only.

To check the backfill after either change: Actions → Backfill should show a run in
progress or queued, and in the Supabase SQL editor

```sql
select job, cursor, last_success_at, last_error from public.sync_state where job = 'backfill-federal';
select count(*) from public.bills where congress = 119;
```

shows the cursor moving forward and the bill count growing over the next hour.

## Checks afterwards

Run these on the new address (custom domain) or the new path (rename on `github.io`):

1. The home page loads with styles, the menu works, and the search box opens.
2. A deep page loads directly in a new tab: `/bills/119/hr/1/`, a member page,
   `/committees/`, a Boston council matter.
3. An old link (`https://jackhale98.github.io/opencongress/bills/`) lands on the same
   page at the new address (custom domain only).
4. **Sign in** with your email: the link in the email opens `/account/` signed in.
5. **Find my reps** with a full street address shows representatives (no
   cross-origin error).
6. A discussion page loads its poll, and you can vote.
7. **Admin: discussions** opens and lists everything.
8. Actions: the latest **Deploy site**, **Nightly rebuild** (next day) and
   **Backfill** runs are green or in progress.
9. In the Supabase SQL editor,
   `select jobid, status, start_time from cron.job_run_details order by start_time desc limit 20;`
   shows recent runs succeeding.

## Undoing a change

- **Custom domain:** Settings → Pages → remove the custom domain, then run Deploy
  site. The site returns to `jackhale98.github.io/opencongress/`. Restore the
  Supabase Site URL; keep both redirect URLs and both `SITE_ORIGINS` until things
  settle.
- **Rename:** rename the repository back to the old name (only possible if nobody has
  created a repository with that name meanwhile), then run Deploy site. If the chain
  of backfill runs stopped, start it again as described above.

## Where each setting lives

| Setting | Place | Changes for a domain | Changes for a rename |
| --- | --- | --- | --- |
| DNS records | Registrar | Yes | No |
| Pages custom domain, HTTPS | GitHub → Settings → Pages | Yes | No |
| Site build path and canonical URLs | Set by Deploy site from Pages | Rebuild | Rebuild |
| Auth Site URL, Redirect URLs | Supabase → Authentication → URL Configuration | Yes | Only on `github.io` |
| `SITE_ORIGINS` | Supabase → Edge Functions → Secrets | Add new origin | No |
| SMTP sender | Supabase → Authentication → Emails → SMTP | Optional | No |
| Pol.is | Pol.is → Integrate | Usually no | No |
| Secrets and variables | GitHub → Settings | No | No (they move) |
| Scheduled syncs (pg_cron) | Supabase | No | No |
| Backfill progress | Supabase `sync_state` | No | No |
| README and footer links | Repository | Cosmetic | Cosmetic |
