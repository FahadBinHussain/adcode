# New advertiser welcome email

New advertiser workspaces automatically receive one professional setup email from `adcode@bluethenics.com`. It greets the brand, explains campaign copy and targeting, suggests a small controlled test budget, links to the advertiser portal, and invites the owner to reply for setup help. It makes no promises about traffic or sales. This account-setup message does not enroll anyone in recurring marketing.

The quarter-hourly Worker schedule prepares and delivers up to ten welcome jobs. The jobs share the existing 50-attempt daily campaign budget, sender verification, sending switch, and configured mailing address. A unique advertiser ID prevents repeated welcomes. Verified active owners are selected from server-side account records; no recipient comes from a public request. Suppressed addresses, suspended advertisers, changed owners and changed email addresses are checked before delivery.

Apply `20261024180443_advertiser_welcome_emails.sql` before deploying. `email_settings.advertiser_welcome_since` is initialized to the migration time, so existing advertisers are not backfilled. Newly created workspaces may qualify for up to seven days, including owners who verify their email after creation. There is no manual campaign blast or initial send to the existing advertiser list.

Retry keys are stable per job. Claims use a ten-minute lease, at most five attempts, and a retry window under 24 hours to stay within provider idempotency. Accepted sends are persisted separately from network failure handling. Delivery and bounce webhooks recognize welcome jobs, including events arriving before their provider receipt was saved. Existing email event handling is preserved.

Validation: `node scripts/check-advertiser-welcome-sql.mjs` exercises queue eligibility, no historical backfill, duplicate prevention, account changes, suppressions, leases, retry expiry, the shared daily limit, early webhooks and private access. Service and template tests mock delivery; tests never send real emails.
