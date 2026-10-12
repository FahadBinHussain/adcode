# Included AI and model catalogs

The desktop can offer Tagflow, OpenAI, Gemini, Groq and OpenRouter models without a user-supplied provider key. Requests travel
through the dedicated `/v1/ai/tagflow` relay; advertising routes do not handle this content.
The provider key stays in Cloudflare. The admin page is **Free models**, at `/admin/tagflow`.
The separate **BYOK models** page at `/admin/models` controls personal-key model defaults,
recommendations, visibility and newly added models. Both pages link to each other.

## Add new free models

1. Open **Admin → Free models → Server connections**. Add the provider's named encrypted
   secret in Cloudflare. The page reports whether it is configured; it never accepts or displays keys.

   | Provider | Cloudflare secret |
   | --- | --- |
   | Tagflow | `TAGFLOW_API_KEY` (existing `tagflow-api` also accepted) |
   | OpenAI | `INCLUDED_AI_OPENAI_API_KEY` |
   | Gemini | `INCLUDED_AI_GOOGLE_API_KEY` |
   | Groq | `INCLUDED_AI_GROQ_API_KEY` |
   | OpenRouter | `INCLUDED_AI_OPENROUTER_API_KEY` |
2. Choose **Add model**, select its provider, enter its exact model ID and display name,
   context/output capacities, and your actual input/output prices in USD per million tokens.
   ADCode IDs must be unique. Use the optional exact provider ID if the ADCode ID is an alias.
3. Keep **Show in the free tab** checked, choose the default, enable included AI and save.
   Models without configured keys are hidden. A disabled model cannot receive requests,
   even from an older cached desktop. The enabled default must have a configured key.
   Use **Test model** after saving to request a short reply with your server key. A test
   uses your verified account and one request from its normal allowance.
4. Users open **Connect a model → Free · no API key** and choose **Use this model**.
   New and older unconnected default profiles select included AI automatically. The
   empty model setting follows your chosen default. A verified ADCode account is required.

These models are free to users within their allowance; you supply the key and cover any
upstream charges. All included providers share each account's limits. BYOK requests go
directly from the user's computer and use their own provider account.

Other provider addresses are fixed to the official compatible APIs:
[OpenAI](https://developers.openai.com/api/reference/resources/chat),
[Gemini](https://ai.google.dev/gemini-api/docs/openai),
[Groq](https://console.groq.com/docs/openai), and
[OpenRouter](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).
Admins cannot supply arbitrary relay hosts or name unrelated server secrets. Redirects are refused.

## Enable the service

1. Apply `supabase/migrations/20261010120000_tagflow.sql` to the production Supabase database.
   This adds separate count-only tables and atomic reservation/settlement functions. RLS
   denies direct browser access; only the server's service-role client can use them.
2. Get the exact OpenAI-compatible API base URL, model IDs, context/output capacities and
   prices from your Tagflow deployment. The public site confirms compatibility but does
   not publish deployment credentials or API model IDs. Display names on the site are
   not assumed to be API IDs.
3. From `apps/web`, set the server secret with `npx wrangler secret put TAGFLOW_API_KEY`.
   Enter the key at its hidden prompt. Never put it in desktop settings, the source tree,
   a `NEXT_PUBLIC_` variable, or this document. The existing `tagflow-api` secret name is
   also supported; `TAGFLOW_API_KEY` takes precedence when both exist. Secrets belong in
   Cloudflare's Secrets settings, and do not need a plaintext entry in `wrangler.jsonc`.
4. Deploy the updated Worker and ship the updated desktop build using the existing release
   process. No deployment or live database change is performed by adding this feature.
5. In **Admin → Free models**, enter the API base URL including `/v1` if your deployment
   requires it. Only HTTPS on `tagflow-ai.com` or a subdomain is accepted. Redirects are
   refused. If Tagflow gives you a different domain, that destination needs a deliberate
   code review before it can receive chat content and the provider credential.
6. Add exact model IDs and display names, limits, and your agreed prices in USD per million
   input/output tokens. Zero price means zero upstream charge; enter your actual rates
   to make the spending limit meaningful. Offer models supporting text chat and tool calls.
7. Select the default model, set default per-user allowances, enable the service and save.
   The service starts disabled, and cannot be enabled until the server secret is present.
8. Tagflow is the default for new installations and older unconnected default profiles.
   Existing connected providers remain selected. Sign in to a verified desktop account and
   test a short conversation and a tool call; there is no key or model selection on a fresh
   installation. An empty model setting follows the model selected by the administrator.
   Check the allowance in **AI usage** and the same account's counts in the admin panel.

## Controls and accounting

- The default token allowance is **1,000,000 tokens per user per UTC day**. Apply
  `supabase/migrations/20261011124739_included_ai_one_million_daily_tokens.sql` when
  upgrading an existing installation: it raises saved positive default and individual
  token limits below 1M, keeps larger custom limits and zero-disabled allowances, and
  preserves block flags and usage already spent. Updating the code default alone does
  not change a configuration already saved in the database.
  This migration was applied to the production ADCode database on October 11, 2026;
  the live default is now 1M tokens. The desktop reads the saved server allowance,
  so changing the local build alone cannot change the total it displays.
- Requests are unlimited by default, both daily and per minute. The numeric wire values
  `dailyRequests: 1000000` and `requestsPerMinute: 1000` encode unlimited request counts
  for compatibility with existing relays; the reservation function skips those checks
  entirely, including when usage exceeds those values. The desktop displays **Unlimited**.
  Apply `supabase/migrations/20261011130936_unlimited_ai_requests_and_context.sql`
  to update saved positive request limits and the database function. Zero-disabled
  request limits, block flags, token/cost limits and existing usage are preserved.
  Token and estimated spending limits still apply. Provider rate limits may apply.
  Each account has a separate allowance; days reset at **00:00 UTC** (05:30 in Asia/Calcutta).
- The default request input ceiling is 262,144 tokens. Each model's supported total
  context remains authoritative, with room reserved for the maximum reply. Only raise
  a model's context after verifying support on the configured provider deployment.
  The provider owner confirmed Tagflow Code 27B has a **262,144-token (256k)** window.
  `supabase/migrations/20261011144315_model_audience_and_256k_context.sql` raises this
  model and the shared input ceiling, preserving larger windows and other models.
  The previous 128k setting was verified with a real 130,530-input-token request;
  the new setting is configuration confirmed by the owner, not a new 256k benchmark.
- Paste an account ID from **People** into **Individual allowance**, or select its usage
  row, to block that account or set custom limits. **Use current defaults** clears a
  custom allowance. Saving limits does not erase usage already consumed.
- Requests reserve their input plus maximum allowed output and cost atomically in
  Postgres. Parallel chats, agents, devices and Worker isolates cannot reuse the same
  allowance. One turn can make several provider requests for tools; each counts.
- Input reservations use estimated tokens (UTF-8 bytes divided by three, plus framing).
  Large prompts
  or a maximum response that cannot fit in the remaining quota are refused before the
  provider call. Model and request output caps are clamped on the server.
- Context sizing and allowance reservations use the same estimated input tokens.
  A text byte is not charged as a token. Context overflow,
  unsupported images, unavailable models and invalid message history have separate errors.
- Actual provider usage settles the reservation, including Groq's `x_groq.usage` format.
  Cached-input and reasoning details are already included in provider totals and are not
  added again. Missing counts use marked estimates of input and generated text; streaming
  JSON envelopes are not output tokens. Interrupted streams use final provider counts
  already received; without them, uncertain requests charge the reserved maximum.
  A definite upstream HTTP refusal releases the daily allocation;
  its minute-rate count stays consumed. A settlement failure leaves the reservation
  charged, preventing uncertain writes from creating credit. Worker termination can leave
  a reservation visible until that UTC day's allowance expires.
- The daily spending ceiling is an estimate based on your configured prices, not a
  guarantee of the provider invoice. Tokenizer framing, provider-specific billing and
  price changes can differ. Configure an account spending cap with Tagflow as well.
- Counts are per account per UTC day. The admin report displays up to 200 accounts with
  highest spend on a chosen date. Local history also records Tagflow requests; its cost
  is zero to the user because ADCode pays. Clearing local history cannot reset quota.
- Included AI currently accepts text and tool calls, not images. Embeddings, Responses API
  calls, reasoning-specific wire formats and separate audio generation are not exposed.
- Clients refresh offered models within five minutes when opened or queried. A changed
  model or disabled service is enforced on the next server request regardless of cache.
- Verified sign-in is required to avoid funding a new allowance for every anonymous
  installation. Banned users and individually blocked accounts cannot use the relay.

## Provider reports for free models

Open **Admin → Free models → Provider reports**, at `/admin/tagflow/reports`, or use
**View provider report** beside a model. Each configured included model has its own
report, including models without requests yet. Removed models and changed upstream
revisions keep separate history. BYOK and local requests do not pass through this relay.

Apply `supabase/migrations/20261011141750_free_model_provider_reports.sql` before
deploying this report feature. Collection starts when that migration is applied; older
account-level counts cannot establish historical per-model usage. The migration adds
metadata-only requests, voluntary feedback and database aggregation functions. Tables
and functions are accessible only to the service-role client; the API checks admin access
and audits report reads. SQL aggregation avoids a browser row limit truncating totals.

Choose 7, 30, 90 days or a custom UTC range of up to 93 days. The report includes:

- Demand, distinct/new/returning/repeat accounts, daily trends and equal-duration
  preceding-period comparisons, with partial historical coverage stated explicitly.
- Input/output tokens, input-size distribution, estimated provider spend, workloads,
  tool usage, peak requests/tokens per UTC minute and observed concurrent calls.
- Successful responses, provider failures and sanitized categories/status codes,
  separately from ADCode rejections, relay/accounting errors, cancellations and unfinished records.
- Response latency, first text/tool output, and reported output speed p50/p95 with sample
  counts. These are relay-observed measurements, including network/bookkeeping effects.
- Helpful/not-helpful ratings, feedback categories and explicitly approved comment excerpts.

**Download provider briefing** creates a standalone HTML document containing the full
report, executive briefing and definitions. **Print / save PDF** opens its print view.
CSV and JSON exports support further analysis; all-model HTML/CSV downloads are available.
Provider error rate uses `provider errors / (successes + provider errors)`. The report
does not infer provider uptime, successful tool execution, task completion or correctness.
Admin **Test model** requests are excluded from customer statistics.

The updated desktop lets users submit model feedback from the response rating buttons.
Ratings are owned by the originating account, one per request, and can be replaced or
removed. Comments are optional and private unless the user checks the provider-sharing
option. Exports contain no account IDs, prompts, replies, source files, tool arguments,
API keys or raw upstream errors; at most 50 approved comments per model are included.
Operational metadata has no automatic retention cutoff yet. An operator's retention
policy should cover these new tables too; deleting a request cascades its feedback.

## Retention and failure behavior

Accounting tables contain no prompts, replies or API keys. Existing server observability
must not be changed to log request bodies or authorization headers. After your chosen
retention interval, an operator can delete old `tagflow_minutes` rows and settled
`tagflow_reservations` rows for expired UTC days; daily usage history can be retained for
your reporting policy. Do not delete current-day pending reservations to manufacture quota.
The legacy Firestore adapter deliberately fails closed for this service; production uses
Supabase. If the migration, provider configuration or secret is missing, included AI is
unavailable and existing user-key/local providers remain usable.
