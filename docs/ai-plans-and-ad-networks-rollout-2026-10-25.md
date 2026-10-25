# AI plans, ad networks and report fixes — 25 October 2026

## Implemented

- Weekly: $3/week, 60M Heabsy tokens/week. Monthly: $9/month, 60M/week. Pro: $19/month, 150M/week and two eligible invites. An invitee who accepts before first subscribing and a still-active Pro inviter receive 4M purchased tokens each, once per invitee.
- Signed subscription events, immutable account/customer ownership, product-ID-based plan changes, chronological event handling, expiry-aware allowance caching, checkout and customer portal.
- Durable per-account hosted-checkout claims prevent multiple payable subscriptions across Worker instances. Same-plan retries resume the saved URL. An ambiguous provider failure preserves the claim for 25 hours rather than creating another potentially payable session. Missing product configuration is checked before claiming. Support must reconcile an ambiguous checkout with Dodo before any manual recovery.
- Admin gifts, boosts, promos and weekly reset for one account or everyone. Everyone resets process at most 500 accounts per request, preserve busy holds, show progress and support pausing/resuming. Keep the admin page open: its progress checkpoint is currently local to that page.
- Website plan comparison, confirmed activation, code redemption, invite sharing and subscription management. Desktop plan meter and Upgrade plan action. Searchable help, feature catalogue and web guides.
- Generic HTTPS JSON ad APIs with configurable requests/field mappings, encrypted write-only provider keys, per-view/per-click payout snapshots and provider-confirmed event settlement. Direct campaigns retain delivery priority. The desktop's existing ad controls apply.
- External artwork passes through an issued-delivery-only server proxy on the approved asset host, with bounded raster downloads. Receipt batches make bounded progress and duplicate payouts are rejected atomically.
- Imprezia supports its documented non-billable Native 1.2 Exchange test preview, using provisioned app bundle/domain and an Exchange-enabled serving key. Its fixed endpoint is `POST https://x.imprezia.ai/v1/bid`; tests always use `test:1`, respect no-bid/expiry and never execute HTML or trackers or invoke bearer notice URLs. Live delivery remains disabled: approved inventory, privacy/rendering/tracking support and an agreed billing/reconciliation process are still required. A notice acknowledgement is not revenue confirmation. Reference: https://demo.imprezia.ai/docs/exchange. An arbitrary API key alone cannot describe arbitrary providers.
- beehiiv publication/offer advertisements are a read-only newsletter content preview. The supplied endpoint does not provide desktop ad delivery or verified desktop earnings.
- Checklist status normalization and retirement after repeated invalid updates, early rechecking after allowance changes, and bounded rate-limit waits. Provider throttling remains distinct from an unlimited ADCode allowance. HTML edge errors retain their HTTP status but show a readable message.

## Dodo configuration completed

Created these recurring products under the `adcode` brand with SaaS tax category and USD pricing. No purchase was made.

| Plan | Product | Recurrence |
| --- | --- | --- |
| Weekly | `pdt_0NqTxj8yBt5W0zfQ17C1P` | $3 every 1 week |
| Monthly | `pdt_0NqTy6TGnS4Txwjpd69sG` | $9 every 1 month |
| Pro | `pdt_0NqTyXgababs030e9ilb0` | $19 every 1 month |

Saved and verified the three `DODO_PLAN_*_ID` bindings on Worker `adcode`. This configures the existing Worker; it does not publish the new application code.

## Database deployment order

Production already contains `20261024140000_ai_plans.sql`. Before deploying the new Worker, apply these additive migrations in order:

1. `20261025040106_harden_ai_plan_events_and_cache.sql`
2. `20261025040541_ad_network_connections.sql`
3. `20261025063235_guard_ai_plan_checkouts.sql`

All new credentials, plan and settlement tables/RPCs are service-role-only. Do not deploy the checkout code before the checkout-claim RPC exists. Existing `PAYOUT_ENCRYPTION_KEY` can derive a separate namespaced ad-network key; a dedicated `AD_NETWORK_ENCRYPTION_KEY` overrides it. Do not replace an encryption root without preserving previous-key reads until credentials are re-encrypted.

## Verification and release gates

Final full verification passed all four TypeScript projects, the dependency firewall and 5,593 tests across 460 files. The firewall reported existing orphan warnings. An initial outdated admin-navigation test expectation was corrected. A Next production build generated all 203 pages successfully. A final Imprezia test-preview addition and distinct React sibling keys are undergoing focused checks; the Cloudflare-compatible build and local runtime preview remain pending.

Local browser fixtures confirmed delayed subscription activation, successful promo redemption after an expiry error, encrypted-key entry clearing, beehiiv content preview, disabled unsupported delivery, and phone layout without page overflow. Fixtures use synthetic data and do not exercise a live card purchase.

Pending release acceptance: apply migrations, publish web/API, inspect health/config/plan/ad admin routes, watch focused error logs, then have the owner subscribe and cancel a real Weekly plan through Dodo. Desktop installer/updater publication and desktop smoke remain a separate release. Do not represent local desktop fixes as shipped.

No 500,000-user load test was performed. The changes remove known unbounded admin work and redundant configuration reads; those checks do not establish production capacity.

See `error-report-triage-2026-10-25.md` for the six latest reports and five support replies.
