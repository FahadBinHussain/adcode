# Automatic purchase confirmations

After the receipt migration and Worker are deployed, ADCode queues transactional confirmations from signature-verified Dodo `payment.succeeded` events. The sender is `ADCode <adcode@bluethenics.com>`. Checkout redirects, active plans, gifts, trials and list prices are not payment evidence.

## What is confirmed

- **AI-plan charges:** initial payments, renewals and proration each use their actual payment ID. The email confirms the amount, currency, payment date and subscription reference. It does not infer an old plan name or covered period from the subscription's current state.
- **AI-token packs:** the charge must match a server-owned, paid token order and its recorded provider payment. The receipt identifies that pack.
- **Advertising credit:** the charge must match a paid credit order. Its recipient must resolve to a verified owner of that advertiser whose address matches the stored billing email.

Every amount comes from Dodo's signed `total_amount` in the charged currency's smallest unit, including any tax or discount in that total. USD, zero-decimal currencies such as JPY, and three-decimal currencies such as KWD are formatted exactly, retaining every allowed minor unit. A successful zero-total plan checkout says **No payment collected**. An active free/trial subscription without a successful payment event sends no receipt. Payment-method setup/verification charges are excluded. Dodo remains the merchant of record and supplies the official tax invoice.

The journal retains only the charge identifiers, actual amount/currency and timestamps needed for matching and deduplication. Webhook customer email, metadata UID and metadata plan are never used as recipient ownership. Plan recipients come from a known subscription with a matching customer ID; all recipients must be active verified account records. The sender labels the address **Sent to**, because it can differ from Dodo's invoice billing address.

## Delivery and recovery

The quarter-hourly Worker job matches at most 100 due charge records and sends at most ten due receipts. A payment that arrives before its fulfillment/subscription webhook remains in a pending journal and retries for seven days; it does not block newer payments. Source lookups use primary keys and the two queue selectors use dedicated partial indexes. The job does not scan historic subscription, order, reservation or model-request tables.

The database owns one immutable receipt per payment ID, a ten-minute send lease, at most five attempts, exponential retry delay and a retry cutoff of 23 hours after the first attempt. Before the first network attempt, an atomic first-write RPC freezes the complete outbound request: recipient, sender, reply address, subject, HTML, plain text and tags. Resend receives that exact persisted request with the same `purchase-receipt/<job id>` idempotency key on every attempt, including after a template, origin or postal-address update. An expired claimant cannot send a new payload or release a newer claimant's lease. Active leases move out of the due-index range until expiry.

Recording a charge never holds back what was bought: the webhook applies the plan, tokens or credit first, and only then answers a failed journal write with a retryable 503 so Dodo delivers the event again. Fulfilment is idempotent across that retry.

Ambiguous sends are never retried beyond the provider's 24-hour idempotency window. An in-progress idempotent request's documented 409 response is retryable; changed-payload, unknown and malformed conflicts are terminal. An accepted send is recorded separately from network-failure handling. Conflicting repeated charge facts are quarantined for review rather than generating a new receipt.

Delivery, bounce, complaint, failed and suppressed events are reconciled even when the webhook arrives before the send acknowledgement is saved. The acknowledgement commits its provider ID and a durable reconciliation flag first. Reconciliation runs as a separate keyed transaction without prelocking a receipt row; the next cron retries unfinished reconciliation through a bounded partial-index sweep. This keeps acknowledgement locks separate from the suppression and per-email locks used by legacy handlers.

A provider failure remains terminal despite duplicate send acknowledgements; a provider-suppressed receipt is cancelled without inventing a bounce/complaint reason or automatically resending its accepted provider ID. Definitive delivery proof is retained across out-of-order failure events. The migration forwards the existing email-event handler and extends it for receipts, preserving existing mail kinds. A bounced or complaining address is suppressed, and the matching receipt retains its terminal delivery error. Changed, unverified or inactive recipient records stop an unsent receipt. Marketing unsubscribe preferences do not block transactional receipts; receipts do not consume the campaign's daily budget. Provider/account limits still apply, and 429 responses stop the batch and retry safely.

## Deployment and historical purchases

1. Apply `supabase/migrations/20261027120000_purchase_receipts.sql` before deploying the Worker. It creates new journal/queue tables and extends the event handler; no existing financial counters or payment rules change.
2. Keep the verified sender, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, HTTPS site origin and configured postal address. The receipt flow runs independently of the marketing sending switch.
3. Deploy the journal handler and scheduled mailer together. New paid events become eligible from the migration's timestamp. Existing buyers are **not** backfilled automatically.

Moving an eligibility floor alone cannot reconstruct missing historical charge facts. Any historical reconciliation must be explicitly scoped and approved, use verified provider charge records, and retain the same payment-ID deduplication. Never manufacture receipts from current plan access or list prices.

Read-only configuration checks on 27 October confirmed the sender domain's SPF/DKIM verification, sending capability and an enabled delivery/bounce/complaint webhook. No real receipt, test purchase or historical backfill was performed as part of this validation.

## Validation

```sh
node scripts/check-purchase-receipt-sql.mjs
npx vitest run services/api/test/purchaseReceiptPayments.test.ts services/api/test/purchaseReceipts.test.ts apps/web/test/purchaseReceipt.test.tsx services/api/test/funding.test.ts services/api/test/aiPlanRoutes.test.ts
```

The SQL check replays migrations in local PGlite and exercises actual charge amounts, ownership, out-of-order and duplicate webhooks, renewals, zero totals, suppression, delivery reconciliation, leases, retries, future-only eligibility, bounded work, index use and the untouched campaign budget. Runtime and template tests mock delivery and never send real mail.

Primary payment schema: [Dodo's maintained SDK](https://github.com/dodopayments/dodopayments-typescript/blob/main/src/resources/payments.ts). Sending behavior follows [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
