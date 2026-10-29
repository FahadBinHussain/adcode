# The status page

`https://adcode.bluethenics.com/status` - what ADCode's included AI models are doing, in public, with the
incident log beside it. Two halves with one rule: **model health is measured, incidents are
written.**

## What people see

- **The banner**, the first thing on the page. No open incident means "All systems
  operational" (or amber/red if the models disagree, which is the honest reading). An open
  incident means one banner per incident, worst first, with the newest update under the
  title and its timestamp.
- **Models**, one row each: live state, provider, seven days of two-hour candles (84 bars),
  request success percentage, requests, error rate and average response time. Hovering a
  candle names its UTC start and end, requests, errors and average. The live state uses a
  rolling 15-minute sample, so a recovered model does not stay degraded because of earlier
  failures. The provider is shown because one model id can reach ADCode
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
Every enabled model appears. Models without requests in the last 15 minutes say "No recent
traffic"; their empty candles are grey and their success percentage is unknown.

## Where the numbers come from

`ai_model_requests` - timestamped requests measured by the included-AI relay on every
platform. `read_model_status_buckets` aggregates in Postgres, so PostgREST row limits cannot
truncate the sample. Only aggregate counts and successful-response durations leave the
database: no account, request ids, messages or upstream error text. Successful requests,
provider failures, relay failures and `model-busy` capacity rejections count. Pending,
cancelled, admin tests and client-side rejections do not.

`services/api/src/status.ts` assembles candles and the rolling live state, shares the
thresholds and combines model health with incidents. `statusTelemetry.ts` defines the
aggregate wire types and candle interval. Scheduled performance reports retain their daily
30-day measurement window:

| Level | Meaning |
|---|---|
| Operational | Under 5% errors |
| Degraded | 5% or more errors, below the outage threshold |
| Live outage | At least 90% errors, on at least 5 requests in the last 15 minutes |
| No recent traffic | No measured requests in the last 15 minutes |

A partial model failure makes the overall banner degraded. It becomes an outage only when
every enabled model is in outage, or a major/critical incident is active. Historical candles
retain the 25% high-error threshold to show past disruption clearly. The API exposes
`liveWindowMinutes` separately from `windowDays`.

On smaller screens the cards and timestamps stack, all 84 candles fit the available width,
and each model has a native expandable list of the latest 24 hours. It works by touch and
keyboard without client JavaScript.

The candle window is seven days (`STATUS_CANDLE_DAYS`), with fixed two-hour UTC intervals.
The incident window remains 90 days, clampable between 7 and 90 via `?days=`. Legacy stores
without relay aggregation retain daily outcome reporting. The public route is `GET /v1/status`,
unauthenticated and cached for a minute at the edge; the page and feed revalidate every 60 seconds.

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
   Apply `supabase/migrations/20261024142631_model_status_candles.sql` before deploying the
   two-hour view. Verify it with `node scripts/check-status-candles-sql.mjs`.
   Apply `20261024165153_live_status_recovery_window.sql` for the shorter live measurement.
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
