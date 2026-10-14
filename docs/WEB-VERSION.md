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
| `DAILY_ALLOWANCE_MIN` | 60 | Running minutes per person per UTC day |
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
½ vCPU), about $0.074 an hour. A person using the whole 60-minute allowance every day costs at most
about $2.22 a month.

## One-time setup (Cloudflare and Firebase)

1. **R2 bucket** `adcode-cloud-homes`, with a lifecycle rule deleting objects older than 90 days.
2. **DNS + certificate**: proxied records for `web` and `*.web` on bluethenics.com, and Advanced
   Certificate Manager for `*.web.bluethenics.com` (Universal SSL covers one wildcard level only).
   Without it the app works; previews do not load.
3. **Firebase Auth → Settings → Authorized domains**: add `web.bluethenics.com`. Without it the
   Google and GitHub buttons fail; email sign-in still works.
4. **Secret** `PREVIEW_COOKIE_KEY` (above).
5. Docker Desktop running: `wrangler deploy` builds the image locally.

## Deploying

```
cd apps/cloud && npx wrangler deployments list     # note the current version for rollback
cd ../.. && npm run cloud:deploy                     # build page + host, then wrangler deploy
```

First deploy: it creates the Worker `adcode-cloud`, its Durable Objects and the container application.
The custom domain comes from `routes`; add `{ "pattern": "web.bluethenics.com", "custom_domain": true }`
and `{ "pattern": "*.web.bluethenics.com/*", "zone_name": "bluethenics.com" }` once DNS and the
certificate are ready.

Rollback: `cd apps/cloud && npx wrangler rollback <version-id> -m "reason"`.

A deploy does not restart running sandboxes; each picks up the new image the next time it wakes.
Archives are plain tar.gz of `/home/adcode`, so they restore into any image version.

After deploying, open the site, sign in, build something, open Preview, close the tab, wait for
`IDLE_SLEEP_MIN`, come back and check the project is still there.

## Watching it

- `GET /admin/stats` (Bearer token of an `ADMIN_UIDS` account): month, spend estimate, running sandboxes.
- `cd apps/cloud && npx wrangler tail` for live logs; observability is on.
- Web usage shows as platform `web` in the included-AI model reports.

## Limits, on purpose

Vibe only: no code editor, terminal panel, debugger, language servers or local models (the help
surfaces hide them on the web). Files over 40 MB are left out of uploads; uploads cap at 200 MB.
Workspaces over 2 GB are warned. The Ollama row says local models need the desktop app.
