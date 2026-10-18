# ADCode web launch

The consolidated source is on `codex/web-launch-2026-10-18`. This is a local integration branch, not a production deployment. The marketing site/API (`apps/web`) and browser workspace (`apps/cloud`) deploy separately.

## Source and verification

- Account controls share the existing website implementation and open inside the workspace.
- Mobile navigation, official Lucide icons, preview feedback, helper timelines, connectors and workspace resizing are integrated.
- Failed restoration cannot expose or snapshot an empty replacement home.
- The shared monthly cloud budget now pauses existing sessions as well as new admissions. The interval is 60 seconds plus save/stop time; it is not a precise provider billing cap.
- Cloud type checking is included in `npm run verify` and both verification/release workflows install the cloud dependencies.
- Cloud builds require all syntax grammars; the container uses a committed dependency lockfile.

Run the following before deployment:

```sh
npm run verify
npm run cloud:build
npm run web:build
npm run smoke:web-vibe -- --no-build
```

Account acceptance uses synthetic responses, never real payouts. `npm run smoke:account` requires a local Vite server; set `ADCODE_ACCOUNT_TEST_URL` if its port differs from 5180. Run heavy browser checks separately on machines where concurrent Chromium fixtures cause contention.

## Production preparation and remaining launch steps

1. Inspect migration history AND actual objects. The initial inspection found the legacy tables/RPCs present and credit windows/RPCs missing. Preparation is now complete after explicit approval.
2. Completed: applied `supabase/migrations/20261018184813_free_ai_credits.sql`, then `supabase/migrations/20261018184823_unlimited_included_ai.sql`. The filenames now match the remote migration versions. Do not replay them on production; migration history and actual schema were verified.
3. Completed: verified `reserve_included_ai` (16 arguments), `settle_included_ai` (7), and `reserve_unlimited_ai` (16). Require service-role execution, no anonymous/authenticated execution, and RLS on `ai_credit_windows`. Keep legacy RPCs for rollback.
4. Completed: added proxied wildcard DNS `*.web.bluethenics.com` as AAAA `100::`. Public DNS resolves, normal TLS verification succeeds, and an unknown preview ID returns the expected 404. A real authenticated preview remains part of deployment acceptance.
5. Validate the Linux sandbox image. Local Docker startup currently fails on an inaccessible stale socket, so a local image build is not yet established. Docker Desktop 4.91.0 is installed. Docker maintainers identify the stuck socket rename as fixed in 4.92+; the current official 4.95.0 update also includes later WSL fixes. Prefer a supported in-place update preserving Docker data/settings, or use another supported Linux Docker host. Avoid factory reset or repeated socket workarounds. See https://github.com/docker/desktop-feedback/issues/460 and https://docs.docker.com/desktop/release-notes/. A Worker-only dry run skips this image check.
6. Deploy the reviewed website/API, then the cloud Worker, assets and image together. The cloud configuration includes `ACCOUNT_API` bound to the existing `adcode` Worker. Current production predates this account gateway.
7. Complete signed-in acceptance: Google/GitHub or email login, workspace startup, a real included-AI request AND settlement, file editing, preview, reconnect, saved-home restore, and account navigation. Use a test account; synthetic tests do not establish real payouts or provider entitlement.

`web.bluethenics.com` is already in Firebase's authorized domains. Presence of secret names does not verify their values. Only the explicitly approved database and preview DNS preparation changed production. No application deployment, payment action, or email send was performed.

## Rollback and local work

Record current deployment version IDs before publishing. Roll back application code if needed; keep additive credit tables/columns/RPCs so old and new code remain compatible. Both budget RPC response shapes are accepted during rolling deployment.

Local campaign drafts, chat exports, AI notes and workspace memory remain on disk and excluded from release source. Completed features were integrated, obsolete clean checkouts retired, and all branch history retained. The private inventory, file hashes, patches and verification logs are in `.tmp/launch-readiness-2026-10-18/`. Do not blanket-stage personal files or delete an intentionally locked worktree.
