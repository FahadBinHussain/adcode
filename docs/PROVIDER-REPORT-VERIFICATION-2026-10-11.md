# Provider report verification — October 11, 2026

The feature adds model-level demand, usage, reliability, latency, capacity, tool and
voluntary-feedback reporting. Provider briefings export as standalone HTML (printable
to PDF), CSV and aggregate JSON; all-model HTML and CSV are also supported.

Validated locally:

- 108 targeted API, export, desktop relay, session restoration, chat markup and real
  Chromium UI tests passed across the validation runs.
- Full type checking and desktop production build passed.
- Dependency boundaries passed with existing orphan warnings and no errors.
- The migration ran against a local Postgres engine. Checks covered distinct and
  returning users, percentiles, peak concurrency, failures versus rejections,
  admin-test exclusion, comment consent and aggregation privacy. An additional 1,100
  rows confirmed aggregation is not truncated at a 1,000-row API limit.
- 19 Chromium checks covered feedback consent, editing/removing ratings, retries,
  submission guards, focused controls, admin-report recovery, model switching,
  zero-demand models, desktop/360px layouts and PDF generation.

Production migration `20261011141750_free_model_provider_reports.sql` was applied.
The web production build and Cloudflare deployment completed successfully, with
version `a7818ee7-f64b-4672-aa69-2c99c8cfa220`. The live admin report and public
report page returned HTTP 200; an unauthenticated report request returned HTTP 401.
A live administrator connection test returned 23 input and two output tokens. Its
request ID was recorded, a private test rating was saved and removed, and the test was
excluded from customer demand. The published privacy page includes the new collection
notice and October 11 date. Desktop feedback also works on restored conversations;
request identifiers are validated and excluded from the AI's message history.

Collection began `2026-10-11T14:17:50.150Z`. Its three tables have RLS enabled with no
browser policies, and grants deny anon/authenticated access. The two aggregate functions
use invoker security and are executable only by the server service role. No conversation
or user identity is present in report exports; shared comments require explicit consent.

## Existing database advisory findings

The post-migration audit also found 21 older `SECURITY DEFINER` functions executable
by each of the `anon` and `authenticated` roles. They include older ledger, user-list,
payout and campaign functions. These findings predate the reporting feature and should
be reviewed separately; this feature does not change their permissions. The new reporting
functions are not among them.

- [Public-function permissions advisory and remediation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Signed-in function permissions advisory and remediation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

The audit's RLS-without-policy informational findings are expected for these
server-only reporting tables; adding a browser read policy would weaken this design.
Existing unrelated foreign-key index notices were also returned.

## Audience expansion and 256k context

The October 11 follow-up adds country, current opt-in user role, experience, AI persona,
observed workflow, declared primary purpose and platform to each model's provider report.
Groups include distinct accounts, demand share, input/output tokens, provider reliability
and previous-period demand. HTML/PDF, CSV and JSON contain these fields and their coverage.
No user identifier is exported. Country is trusted Cloudflare request metadata; client
country headers are ignored. Persona labels are closed categories, including Custom agent.

- 56 focused API, audience-contract, export and usage-dialog tests passed across the
  validation runs. The context test accepts an input above the previous 128k ceiling
  and rejects an input that would exceed 256k after reserving reply space.
- 12 direct Chromium checks cover survey loading/retry, opt-in defaults, focus, submission
  guards, saving, restoration, withdrawal and desktop/360px layouts. Another 21 report and
  feedback checks cover actual tables, 256k display, model selection, recovery and PDF output.
- Local Postgres checks validate country/profile/persona grouping, unknowns, distinct users,
  previous periods, 256k bands, immediate profile withdrawal, admin-test exclusion, denied
  browser roles and aggregation across more than 1,000 requests.
- Full type checking and dependency boundaries passed; the latter has existing orphan
  warnings and no errors. The desktop production build passed and was rebuilt after the
  final fixed-category mapping adjustment.

Production migration `20261011144315_model_audience_and_256k_context.sql` is applied and
recorded. Because older remote migration versions are absent from this checkout, only
this migration and its new history entry were applied together through the authenticated
CLI query path; existing migration records were preserved. The live public catalog reports
262,144 tokens, the global input ceiling is 262,144, and the daily million-token allowance
and unlimited request encodings are preserved. Both new functions use invoker security,
deny anon/authenticated execution and allow the service role. The profile table has RLS
enabled, denies browser roles and allows the server role.

The web production build and Cloudflare deployment passed, version
`9a217fb7-6f44-4b64-9238-dd8630a66288`. Live report access returned 200 for the
administrator and 401 without authentication. The report contains all seven audience
dimensions, current 262,144-token capacity and audience collection start
`2026-10-11T15:04:04.915Z`. A deliberately temporary profile was saved, read and restored
to its original state; a forged account field was rejected with 400.

Live administrator request `755d764b-9e1b-426e-bcc5-4b8bd3802c69` succeeded with 20 input
and two output tokens. Its record has country IN, persona Reviewer, platform Windows
and context 262,144; supplied country headers US/DE were ignored. It was correctly
classified as an administrator test and excluded from customer demand, which stayed
at zero during the check. The live privacy page has country and opt-in profile notices.
The user's open report page was refreshed and visibly shows 256k and all audience
sections. A screenshot is saved at `.tmp/live-provider-report.jpg`.
