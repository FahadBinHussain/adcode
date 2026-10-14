/**
 * The Worker's bindings and settings. Values live in `wrangler.jsonc` (public) and in Wrangler
 * secrets (`PREVIEW_COOKIE_KEY`). Numbers arrive as strings, as every Worker var does.
 */
import type { BudgetObject } from "./budgetObject.ts";
import type { PreviewRoute } from "./previewRoute.ts";
import type { UserSession } from "./userSession.ts";

export interface Env {
  readonly USER: DurableObjectNamespace<UserSession>;
  readonly BUDGET: DurableObjectNamespace<BudgetObject>;
  readonly PREVIEW: DurableObjectNamespace<PreviewRoute>;
  readonly HOMES: R2Bucket;
  readonly ASSETS: Fetcher;

  readonly APP_HOST: string;
  readonly PREVIEW_SUFFIX: string;
  readonly ALLOWED_ORIGINS: string;
  readonly FIREBASE_PROJECT_ID: string;
  readonly FIREBASE_AUTH_DOMAIN: string;
  readonly ADMIN_UIDS: string;
  /** Where adcode-host sends `/v1` calls (ads, earnings, included AI). */
  readonly ADCODE_API_BASE: string;

  readonly DAILY_ALLOWANCE_MIN: string;
  readonly IDLE_SLEEP_MIN: string;
  readonly UNTOUCHED_TAB_MIN: string;
  readonly SNAPSHOT_EVERY_MIN: string;
  readonly MONTHLY_CAP_USD: string;
  readonly MAX_INSTANCES: string;
  /** Container instance type: "standard-1" unless measured otherwise. */
  readonly INSTANCE_TYPE: string;

  /** Secret. Signs preview cookies. */
  readonly PREVIEW_COOKIE_KEY: string;
  /** Local development only: accept the token "dev" as a fixed test user. Never set in production. */
  readonly ALLOW_DEV_TOKEN?: string;
}

export function numberVar(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
