# Discussions (Pol.is)

Discussions are structured conversations hosted by [Pol.is](https://pol.is). Each
one asks a single neutral question, usually about a bill or Boston City Council
matter. Participants vote agree, disagree or pass on short statements and can add
their own; Pol.is groups people by how they vote and reports where opinion divides
and where it agrees.

Maintainers create discussions. Anyone signed in can ask for one on a bill, state
bill or council matter page; request counts are public, requesters are not.

## One-time setup

1. Create a Pol.is account for the project (pol.is → Sign up) and open
   **Integrate**. Copy the site id (`polis_…`).
2. Set the repository variable `PUBLIC_POLIS_SITE_ID` to it and rebuild the site.
   Without it, discussion pages show a notice instead of the embed.
3. Make yourself a maintainer. In the Supabase SQL editor (service role):

   ```sql
   insert into public.admins (user_id, role)
   select id, 'admin' from auth.users where email = 'you@example.org';
   ```

   `role` is `admin` or `moderator`; both can manage discussions today. Users
   cannot add themselves (RLS), and the list of admins is not readable by anyone.

## Creating a discussion

1. Sign in and open `/admin/discussions/`.
2. Fill in the form. The **id** is a short slug (`boston-bike-lanes-2026`); it
   becomes the URL (`/discussions/<id>/`) and the Pol.is `page_id`, so it cannot
   change later. Keep the **title** a neutral question and use the same prompt
   template everywhere: one paragraph of background with a link to the item, then
   the question.
3. Choose the jurisdiction (United States, Massachusetts or Boston, optionally one
   council district) and whether only residents may vote and write.
4. Save as **draft**. Drafts are visible only to maintainers.
5. Open the draft's page while signed in to your Pol.is account. With a `site_id`
   and a new `page_id`, Pol.is creates the conversation on first load and makes
   the site owner its moderator.
6. In the Pol.is moderation view, set the topic and description, turn on
   **strict moderation** (statements need approval before others see them) and add
   6–10 **seed statements** covering the main positions evenly. Write seeds for
   every side before opening.
7. Set the status to **open**. Followers of the linked item get a feed event, and
   the next site build gives the discussion a prerendered page (until then
   `/discussion/?id=<id>` serves it, and the clean URL forwards there).

Only discussions on the agreed pilot list (3 Boston, 2 Massachusetts, 2 federal)
may be opened without asking the project owner.

## Moderating

Moderate in the Pol.is dashboard under the rules published at `/moderation/`:
accept or reject statements, never edit them, and judge only the rules, never the
view expressed. Check open discussions at least daily. To stop new input, set
the status to **closed** in `/admin/discussions/`: the embed then lets everyone
read results but not vote or write.

## Residency

When **residents only** is on, the site checks the signed-in user's saved address
(Find my reps → Save): state for Massachusetts, `city = 'boston'` and, for a
district discussion, the council district. Users who do not qualify can read but
the embed is loaded with voting and writing switched off. This is an honor system
on the client; someone determined could open the Pol.is conversation directly.
Treat results as indicative and publish participation counts with them.

## Privacy rules

- The only user identifier sent to Pol.is is `profiles.polis_xid`, a random UUID
  created per user, sent only when the user may take part. Never the auth id,
  email, address or districts.
- `data-parent_url` is the page's clean URL without query string or fragment, and
  `document.referrer` is reduced to the site origin before `embed.js` reads it.
- Removing a saved address clears the address fields but keeps the profile row,
  so the user stays the same Pol.is participant. Deleting the account deletes it.

Check this after any change to the embed:

```sh
npm run db:start && npm run db:reset
BASE_PATH=/opencongress/ PUBLIC_POLIS_SITE_ID=polis_check PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  PUBLIC_SUPABASE_ANON_KEY=<local anon key> npm run build
# serve site/dist at http://localhost:4321/opencongress/ (404.html for missing paths), then:
SUPABASE_SERVICE_ROLE_KEY=<local service key> npm run check:polis
```

The script opens a discussion signed out and as a signed-in resident, records
every request the browser makes to pol.is, and fails if any contains the user's
auth id, email or address, if an xid is sent while signed out, or if the query
string or fragment of the page leaks into `parent_url`.

## Exporting results

In the Pol.is dashboard, open the conversation's **Report** to get a public
report URL, and **Export** for CSV files of statements, votes and participants
(participants appear only by Pol.is id). Link the report from the discussion's
prompt when it closes. Pol.is also publishes conversations as open data.
