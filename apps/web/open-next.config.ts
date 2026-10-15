/**
 * How `@opennextjs/cloudflare` builds this app for the Worker runtime.
 *
 * This used to be the default configuration, whose page cache is a no-op: every page was
 * rendered on every request, including the ~140 prerendered docs pages, and each render
 * read the posts from the database. A docs page took 0.4-1.4 s before its first byte, and
 * a cold one over 2.5 s - measured 2026-10-15, after a user asked why the site was slow.
 *
 * Now a rendered page is kept in R2 (`NEXT_INC_CACHE_R2_BUCKET`, wrangler.jsonc) and
 * served from there. Pages that read from the API revalidate every 60 s, so publishing
 * from the admin panel still appears without a deploy: once a page is a minute old, the
 * next visitor gets it as it is and a fresh one is rendered in the background through
 * `WORKER_SELF_REFERENCE`. The regional cache keeps a copy in the data centre that served
 * it, so a visit does not wait on R2's own location either.
 *
 * No tag cache: nothing calls `revalidateTag` or `revalidatePath`, so time is the only
 * thing that makes a page stale. Add one before adding either.
 *
 * Deliberately NOT `enableCacheInterception`. Next 16.3 stores pages under
 * `/route-cache/APP_PAGE/<hash>/$/<path>`, while OpenNext 1.20.2's interceptor - and the
 * cache it fills at deploy - still use the bare `/<path>`. With it on, a page refreshed in
 * the background landed under the new key while every visitor kept getting the build's
 * copy from the old one, stale for good, and each of them waited on another refresh that
 * could not show. Seen in the local preview on 2026-10-15. Without it the first visit to a
 * page after a deploy renders it, and every visit after is served from the cache.
 */
import { defineCloudflareConfig, getCloudflareContext } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";

/**
 * The memory queue, without the wait.
 *
 * OpenNext awaits `queue.send` before it finishes a response, and the memory queue's send
 * is the whole background render - so a visitor to a stale page waited 2-5 s for a page
 * they were being handed stale precisely so they would not wait. `waitUntil` keeps the
 * render running after the response has gone.
 */
const backgroundQueue = {
  name: "background-memory-queue",
  send: async (message: Parameters<typeof memoryQueue.send>[0]): Promise<void> => {
    getCloudflareContext().ctx.waitUntil(memoryQueue.send(message));
  },
};

export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "long-lived" }),
  queue: backgroundQueue,
});
