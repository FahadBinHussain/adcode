/**
 * web.bluethenics.com: ADCode's Vibe mode in the browser.
 *
 * One Worker for the page, each person's sandbox and their previews. See `router.ts` for who
 * may reach what, `userSession.ts` for the sandbox, and `docs/WEB-VERSION.md` for operating it.
 * It is a separate Worker from `apps/web` (adcode.bluethenics.com and the live `/v1` API) on
 * purpose: nothing a sandbox does can take the site or the ads and payments API down.
 */
import type { Env } from "./env.ts";
import { previewRequest } from "./preview.ts";
import { defaultDeps, route } from "./router.ts";

export { BudgetObject } from "./budgetObject.ts";
export { PreviewRoute } from "./previewRoute.ts";
export { UserSession } from "./userSession.ts";

export default {
  async fetch(request, env): Promise<Response> {
    return route(request, env, { ...defaultDeps(env), preview: (incoming, port, previewId) => previewRequest(incoming, env, port, previewId) });
  },
} satisfies ExportedHandler<Env>;
