# ADCode on the web (web.bluethenics.com)

ADCode's Vibe mode in a browser tab. Each signed-in person gets a private cloud sandbox that runs
the **same main-process code as the desktop app**, and the browser runs **the same Vibe renderer**,
talking to it over one WebSocket instead of Electron IPC.

```
browser ── web.bluethenics.com (Worker: apps/cloud) ──► UserSession DO (one per Firebase uid) ──► Container
 Vibe UI     page + security headers                       allowance, archives, previews          adcode-host
 boot.ts     Firebase token check (subprotocol)            Budget DO: monthly cap, slots          = src/main + electron shim
             p-<port>-<id>.web.bluethenics.com previews    PreviewRoute DO: preview id -> owner   + headless Chromium
```

| Piece | Where | What it does |
|---|---|---|
| Web entry | `apps/desktop/src/web/` | Sign-in gate, reconnecting socket, `window.adcode` built from `bridgeTable.ts` (checked against the untouched preload by `test/webBridgeTable.test.ts`), project picker, uploads, Connect GitHub, Cloud workspace panel |
| adcode-host | `apps/desktop/src/host/` | The main process headless: `electron` is aliased to `electronShim.ts`; IPC handlers answer socket frames; home archive and download routes; agent browser over CDP |
| Cloud | `apps/cloud/` | Worker router, `UserSession` (owns the container via `ctx.container`), `Budget`, `PreviewRoute`; R2 home archives |
| Image | `apps/cloud/container/Dockerfile` | `node:24-trixie-slim` + git, tar, Chromium, node-pty, adcode-host |

The spec is `docs/superpowers/specs/2026-10-14-adcode-web-vibe-design.md` (local, not in git).

## Working on it locally

```
npm run web:vibe          # adcode-host + the page on http://localhost:5180 ("Continue in dev mode")
npm run smoke:web-vibe    # end to end in headless Edge with a fake model - read the printed values
```

`web:vibe` keeps its home in `.tmp/web-vibe-home` and makes a dev sealing key there. The page reads
Firebase's public settings from `ADCODE_FIREBASE_*` or `apps/web/.env.production`.

Wrangler cannot run containers on Windows (it wants WSL). Check the image with plain Docker:

```
npm run cloud:build
docker build -t adcode-sandbox apps/cloud/container
docker run --rm -p 7397:7300 -e ADCODE_HOST_SECRET=s -e ADCODE_SEAL_KEY=<32 bytes base64> adcode-sandbox
curl localhost:7397/__adcode/health
```

## Settings

`apps/cloud/wrangler.jsonc` `vars` (change without a code change; `keep_vars` keeps dashboard edits):

| Var | Default | Meaning |
|---|---|---|
| `SESSION_ALLOWANCE_MIN` | 60 | Running minutes per person per session window (`DAILY_ALLOWANCE_MIN` is read if this is unset) |
| `SESSION_HOURS` | 5 | A window opens with the first running minute and refills this many hours later, like the free AI credits |
| `IDLE_SLEEP_MIN` | 5 | Sleep this long after the last tab closes, if nothing is working |
| `UNTOUCHED_TAB_MIN` | 15 | Sleep an open tab nobody has touched, if nothing is working |
| `SNAPSHOT_EVERY_MIN` | 10 | Archive `/home/adcode` to R2 this often while running |
| `MONTHLY_CAP_USD` | 20 | Stop admitting new sandboxes once the month's worst-case estimate reaches this |
| `MAX_INSTANCES` | 20 | Sandboxes running at once |
| `INSTANCE_TYPE` | standard-1 | ½ vCPU, 4 GiB, 8 GB disk |
| `ADMIN_UIDS` | (empty) | Firebase uids that may read `/admin/stats` |
| `ADCODE_API_BASE` | (empty) | `/v1` origin for adcode-host; empty = production |

Secret: `npx wrangler secret put PREVIEW_COOKIE_KEY` (any long random string; signs preview cookies).

Cost: worst case $0.0012336 per running minute on standard-1 (memory 4 GiB + disk 8 GB + the full
½ vCPU), about $0.074 an hour. A person using the whole 60-minute allowance in every 5-hour window costs at most about $0.36 a
day ($10.66 a month), so `MONTHLY_CAP_USD` is what really bounds the bill: at $20 it covers about
270 sandbox-hours a month across everyone.

## One-time setup (Cloudflare and Firebase)

Done on 2026-10-15 unless marked otherwise.

1. **R2 bucket** `adcode-cloud-homes`, with a lifecycle rule deleting objects older than 90 days.
2. **The app's domain**: `web.bluethenics.com` is a Workers custom domain (`routes` in
   `wrangler.jsonc`); the first deploy created its DNS record and certificate itself.
3. **Previews (still to do)**: a proxied `*.web` DNS record on bluethenics.com (AAAA `100::` is
   enough; the Worker answers), and Advanced Certificate Manager for `*.web.bluethenics.com` -
   Universal SSL covers one wildcard level only. The `*.web.bluethenics.com/*` route is already
   in place. Without these the app works and previews do not load.
4. **Firebase Auth → Settings → Authorized domains (still to do)**: add `web.bluethenics.com`.
   Without it the Google and GitHub buttons fail; email sign-in still works.
5. **Secret** `PREVIEW_COOKIE_KEY` (above).
6. Docker Desktop running: `wrangler deploy` builds the image locally.

## Deploying

```
cd apps/cloud && npx wrangler deployments list     # note the current version for rollback
cd ../.. && npm run cloud:deploy                     # build page + host, then wrangler deploy
node scripts/cloud-probe.mjs https://web.bluethenics.com
```

The probe prints what it checked: the page and its CSP, no development sign-in, and every door
(API, socket, another site's origin) refusing a visitor without a token.

The image is about 2 GB, so the first push of a new image takes several minutes. Cloudflare's
registry times out on a single upload of a few hundred megabytes, which is why the Dockerfile
installs its packages in three layers rather than one. A push that fails on
`timeout awaiting response headers` is worth one retry: the layers already sent are kept.

Rollback: `cd apps/cloud && npx wrangler rollback <version-id> -m "reason"`.

A deploy does not restart running sandboxes; each picks up the new image the next time it wakes.
Archives are plain tar.gz of `/home/adcode`, so they restore into any image version.

### Trying a change on real Cloudflare first

`env.staging` in `wrangler.jsonc` is a throwaway copy: workers.dev only, its own bucket, two
sandboxes and a $2 cap, and it accepts the development token so a script can sign in.

```
npx wrangler r2 bucket create adcode-cloud-homes-staging
cd apps/cloud && npx wrangler deploy --env staging --secrets-file <file with PREVIEW_COOKIE_KEY>
node scripts/cloud-probe.mjs https://adcode-cloud-staging.<account>.workers.dev --staging --restore --delete
npx wrangler delete --env staging && npx wrangler r2 bucket delete adcode-cloud-homes-staging
```

`--restore` waits for the sandbox to sleep and checks the project came back from R2; `--delete`
ends with Delete my cloud workspace and checks the day's time stayed spent. Delete the staging
Worker as soon as the probe has run: while it exists, anyone with its URL can open a sandbox.

## Watching it

- `GET /admin/stats` (Bearer token of an `ADMIN_UIDS` account): month, spend estimate, running sandboxes.
- `cd apps/cloud && npx wrangler tail` for live logs; observability is on.
- Web usage shows as platform `web` in the included-AI model reports.

## Limits, on purpose

Vibe only: no code editor, terminal panel, debugger, language servers or local models (the help
surfaces hide them on the web). Files over 40 MB are left out of uploads; uploads cap at 200 MB.
Workspaces over 2 GB are warned. The Ollama row says local models need the desktop app.
