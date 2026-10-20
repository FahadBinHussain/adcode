# The status page

`https://adcode.bluethenics.com/status` - what ADCode's included AI models are doing, in public, with the
incident log beside it. Two halves with one rule: **model health is measured, incidents are
written.**

## What people see

- **The banner**, the first thing on the page. No open incident means "All systems
  operational" (or amber/red if the models disagree, which is the honest reading). An open
  incident means one banner per incident, worst first, with the newest update under the
  title and its timestamp.
- **Models**, one row each: state pill, provider, 90 days of daily bars, uptime percentage,
  turns, error rate and average response time. Hovering a bar names that day: requests,
  errors, average. Bars are one per UTC day and the percentage counts every turn that was
  not cancelled by the person. The provider is shown because one model id can reach ADCode
  through two of them, and the display name is derived from the id (`qwen2.5-coder:7b`
  reads "Qwen2.5 Coder 7B") rather than from a table that would go stale.
- **Past incidents**, grouped by day, newest first, each update labelled Investigating /
  Identified / Monitoring / Resolved with a UTC timestamp. Today's and the two days before
  it are shown even when empty - an empty today is the answer to "is anything wrong now".
- **Subscribe to updates** copies the RSS feed URL, `/status/feed.xml`. One item per
  update, newest first.

Only the included models appear - those enabled in the included-AI catalog, named as the
model picker names them. A model someone runs on their own key or their own machine is
recorded for the admin panel but is not ADCode's service, so its failures never colour this
page (on 2026-10-20 they read "15 models are failing requests" above a catalog of four).
Only models with turns in the window appear. No traffic is not the same as working, so
there are no rows that say "operational" without numbers behind them.

## Where the numbers come from

`model_outcomes` - the same daily per-model counts the editor already reports for the
admin panel's model health, with no account attached. `services/api/src/status.ts` turns
counts into levels and percentages, so the page, the feed and the panel cannot disagree:

| Level | Meaning |
|---|---|
| Operational | Under 5% errors |
| Degraded | 5% or more, or fewer than 5 turns to judge |
| Outage | 25% or more errors, on at least 5 turns |
| No recent traffic | No turns that day |

The window is 90 days (`STATUS_WINDOW_DAYS`), clampable per request between 7 and 90 via
`?days=`. The public route is `GET /v1/status`, unauthenticated and cached for a minute at
the edge; the page and the feed revalidate every 60 seconds.

## Posting an incident

**Admin > Status page** (sidebar, under Now). One form opens an incident - title, impact,
state, first update - and every incident below it has a composer to add updates. Posting
`Resolved` closes the incident and stamps its resolution time; posting anything else on a
closed incident reopens it. There is no editing and no deleting: an incident is a record,
and correcting one means posting the correction, the way it works for everyone reading.

Writes are atomic in the database (`status_create_incident`, `status_add_incident_update`)
so an incident can never exist without its first update. Updates appear on the page and in
the feed within a minute, without a deploy.

## Putting it live - in this order

1. **Apply `supabase/migrations/20261019120000_status_page.sql`** to production. It creates
   `status_incidents` and `status_incident_updates` and their write functions. Until it is
   applied, `GET /v1/status` answers 500 and the page shows "Status data is unavailable".
2. **Deploy the web** (`npm run web:deploy`) - the API ships with it. Nothing to
   configure: the page is public, the feed is public, and the admin section needs only an
   admin account.
3. **Post an incident by hand once** to see it land (a `Maintenance` / `Informational`
   incident is the cheapest test), then check `/status` and the feed.
4. The desktop app needs no release for any of this - it only reports outcome counts, as
   before.

## Where the rules live

- `services/api/src/status.ts` - levels, the window, parsing, assembly, display names,
  and the handlers; `services/api/test/status.test.ts` pins all of it.
- `supabase/migrations/20261019120000_status_page.sql` - the tables and the two atomic
  write functions; RLS is on and only `service_role` may touch them. It was replayed with
  every migration in PGlite and held to the memory store on one incident; re-run
  `node scripts/check-status-sql.mjs .` (after `npm install --no-save @electric-sql/pglite`)
  for any change to either side.
- `apps/web/src/lib/status.ts` - the reader and its parser (fails to `null`, never to a
  broken render); `apps/web/src/app/status/` - the page, its stylesheet and the feed.
- `apps/web/src/app/admin/_sections/Status.tsx` - the admin composer.
