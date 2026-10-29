import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdvertiserWelcomeStore } from "../src/advertiserWelcome.ts";

export function createSupabaseAdvertiserWelcomeStore(): AdvertiserWelcomeStore {
  let client: SupabaseClient | undefined;
  async function rpc(name: string, args: Record<string, unknown>) {
    if (!client) {
      const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
      if (!url || !key) throw new Error("Advertiser welcome storage unavailable");
      const { createClient } = await import("@supabase/supabase-js");
      client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    }
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error("Advertiser welcome operation failed: " + name);
    return data;
  }
  return {
    async prepare(now) { await rpc("email_prepare_advertiser_welcomes", { p_now: now }); },
    async claim(now, limit) {
      const rows = await rpc("email_claim_advertiser_welcomes", { p_now: now, p_limit: limit }) as { id: string; email: string; name: string }[];
      return rows.map(({ id, email, name }) => ({ id, email, name }));
    },
    async eligible(id, now) { return await rpc("email_advertiser_welcome_eligible", { p_id: id, p_now: now }) === true; },
    async finish(id, result, now) {
      await rpc("email_finish_advertiser_welcome", "providerId" in result
        ? { p_id: id, p_provider_id: result.providerId, p_retry: false, p_code: null, p_now: now }
        : { p_id: id, p_provider_id: null, p_retry: result.retry, p_code: result.code, p_now: now });
    },
  };
}
