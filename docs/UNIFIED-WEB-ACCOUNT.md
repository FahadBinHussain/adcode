# Account controls inside ADCode Web

The browser workspace now opens the existing account UI in a responsive dialog. Earnings,
invites, payout details and requests, activity, ledger history, and email preferences share
one implementation with the legacy `/dashboard` page. The current conversation stays mounted.

## Entry points

- Account in the web rail and the profile button.
- Earnings and invites in the workspace sidebar.
- `/?account=overview` (also `earnings`, `invites`, `payouts`, `activity`, `ledger`, `email-preferences`).
- Your account on a paused or exhausted cloud session; account reads do not wake a sandbox.

The website's sign-in and account links now lead to the browser workspace. The old dashboard
still works for existing bookmarks, and links to the unified workspace.

## Authentication and API

The web Firebase session supplies a fresh ID token for each request. The Cloudflare router
verifies it and forwards only the allowlisted account routes through the `ACCOUNT_API`
service binding to the existing `adcode` Worker. Both production and staging declare that
binding. The API continues to determine identity, payout eligibility, and validation.
Development tokens are rejected by this forwarding route. Cookies and caller identity
headers are stripped; redirects are not followed; account responses are not cached.

Local Vite proxies `/v1` to the existing site. Set `ADCODE_ACCOUNT_API_ORIGIN` to a local
API for fixture development. Dev mode itself shows a clear sign-in prompt instead of fake
balances. No access tokens are put in URLs or saved by the account UI.

## Local verification

- `npm run web:vibe` starts the workspace at http://localhost:5180.
- `npm run smoke:account` uses that server and entirely synthetic account responses. It
  checks rendering, invites, preferences, payout UI, ledger pagination, and mobile widths.
  Screenshots are written to `.tmp/account-check/`.
- `npm run smoke:web-vibe -- --no-build` checks the full workspace with a fake model,
  including opening Account and returning to the same chat. Build the host first with
  `npm run host:build` if needed.
- Cloud account routing has behavioral coverage in `apps/cloud/test/accountApi.test.ts`.

Deployment must include both the web assets and the cloud Worker service-binding change.
This change has only been built/tested locally; no production deployment or real payout
was performed.

## Existing local work

The checkout began on `checkpoint/2026-10-17` with unrelated SEO, gate, ASCII mark,
marketing and session files already modified or untracked. Those were preserved. No bulk
staging, history rewrite, worktree deletion, or removal of those artifacts was performed.

## Final verification (2026-10-18)

Both production builds and the desktop, website, and cloud type checks passed. The account
routing and existing website tests passed. The final browser runs passed account actions,
error recovery, all seven sections on mobile, and the complete workspace flow. Account
closure also preserves the current chat after a frozen tab resumes; cleanup does not wait
for the browser's next painted frame. No browser console errors or horizontal mobile
overflow were reported. Account tests use synthetic data, not real payout transactions.

Local browser reports are saved in `.tmp/account-check/final-smoke.log` and
`.tmp/account-check/account-smoke.log`, alongside desktop and phone screenshots.
