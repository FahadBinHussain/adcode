# Error report triage — 25 October 2026

Reviewed six new bug reports after the previous 24 October triage, including one submitted during this work, using the indexed recent-report list and keyed account lookups. Five accounts have email addresses. Sent five individualized replies from the explicitly confirmed sender, `ADCode <adcode@bluethenics.com>`; Resend confirmed all five delivered. Recorded each provider receipt in `report_replies` and each reply in the audit log. One account has no email, so no reply was sent. Reports remain in progress until fixes are released and their behavior is confirmed.

| Report | Finding | Reply |
| --- | --- | --- |
| rep-8-1792896173189 | Email verification is distinct from sign-in; desktop now explains verification and Retry | Delivered |
| rep-39-1792894578639 | Older Linux desktop receives verification refusal | No account email available |
| rep-5-1792886887730 | Repeated account-change failures after a cached provider remains bound to the previous account | Delivered |
| rep-1-1792877064397 | Dropped response, invalid checklist statuses, missing npm | Delivered |
| rep-5-1792863799822 | Repeated invalid `update_plan` statuses stop the coding task | Delivered |
| rep-36-1792901087365 | Cloudflare stopped an Included AI request that hung; separate Unity command/editor errors | Delivered |

## New fixes

- Normalize the commonly generated `completed` checklist status to `done` and document it in the tool schema.
- After three rejected checklist updates, remove that tool from the current turn and let real coding operations continue. Other tool failures retain their existing stop guard; malformed writes are never executed.
- Recheck account allowance refusals at least every two minutes so administrator resets and allowance changes resume paused work without waiting until the original reset date.
- Bound request-rate retry waits to one minute and distinguish upstream provider throttling from ADCode account usage. Unlimited ADCode usage does not remove the provider's own throttle.
- Preserve existing protections against replaying partial responses or completed tools, and immediate cancellation with no pending timer.
- Replace HTML proxy/edge error pages with a readable error while retaining their HTTP status for bounded recovery. The added provider/recovery regression checks passed (68 tests).

A final indexed queue check found one additional report, `rep-36-1792901087365`. Matched the 03:58:44 UTC failure to Cloudflare's runtime-cancelled hung-request event. Sent a fifth individualized reply describing the verified server failure, separate Unity connection/tool problems, and the actual unpublished desktop release status. The exact cause remains under investigation; no claim of live resolution was made.

The independent review found a remaining shared in-flight JWKS refresh promise in Firebase token verification. Replaced it with completed-key caching and independent fetches with a deadline. Eighteen verifier tests and six database-cache tests pass, including a hung first refresh that no longer prevents a second request from completing. This removes the known Cloudflare request-ownership failure pattern; the production stack was not mapped conclusively to this source, so the individual incident's cause remains probable rather than proven. A subsequent indexed report check found no additional reports.

Focused checks: 74 planning/tool tests and 117 recovery/account/schedule/preview tests passed (overlap includes the agent suite). Full verification is recorded in the implementation rollout report. Existing account-binding, verification-card, transient-connection, schedule-storage, preview-watcher and rendering-timer changes from the previous triage are preserved.

## Release status and limits

The replies explicitly state that desktop changes are tested locally and have not shipped through an installer/updater release. No report was represented as resolved for the reporter. Missing npm, Python imports and project build failures still need the relevant local installation or final traceback; verification still requires the person to open their account's verification link. No credentials or verification links were requested.
