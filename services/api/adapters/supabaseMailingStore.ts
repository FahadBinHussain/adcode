import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailingStore, EmailJob } from "../src/mailing.ts";

export function createSupabaseMailingStore(): MailingStore {
  let client: SupabaseClient | undefined;
  async function db() {
    if (client) return client;
    const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Mailing requires Supabase configuration");
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await (await db()).rpc(name, args);
    if (error) throw new Error("Mailing operation failed: " + name);
    return data;
  }
  return {
    async preferences(uid) {
      const database = await db();
      const [user, prefs] = await Promise.all([
        database.from("users").select("email,email_verified,status").eq("uid", uid).maybeSingle(),
        database.from("email_preferences").select("subscribed,email").eq("uid", uid).maybeSingle(),
      ]);
      if (user.error || prefs.error) throw new Error("Mailing preferences unavailable");
      const email = user.data?.email as string | undefined;
      const eligible = typeof email === "string" && user.data?.email_verified === true && user.data?.status === "active";
      let suppressed = false;
      if (email) {
        const result = await database.from("email_suppressions").select("reason").eq("email", email.toLowerCase()).maybeSingle();
        if (result.error) throw new Error("Mailing suppression check failed");
        suppressed = result.data !== null;
      }
      return { email: email ?? null, eligible, suppressed,
        subscribed: eligible && !suppressed && prefs.data?.email === email && prefs.data?.subscribed === true };
    },
    async consent(uid, enabled, now) { await rpc("email_set_consent", { p_uid: uid, p_enabled: enabled, p_now: now }); },
    async touch(uid, now) { await rpc("email_touch", { p_uid: uid, p_now: now }); },
    async unsubscribe(token, now) { await rpc("email_unsubscribe", { p_token: token, p_now: now }); },
    async settings() {
      const { data, error } = await (await db()).from("email_settings").select("enabled,postal_address,sender_verified_at").eq("singleton", true).single();
      if (error) throw new Error("Mailing settings unavailable");
      return { enabled: data.enabled === true, postalAddress: data.postal_address as string | null, senderVerified: data.sender_verified_at !== null };
    },
    async prepare(now) { await rpc("email_prepare", { p_now: now }); },
    async claim(now, limit) {
      const rows = await rpc("email_claim", { p_now: now, p_limit: limit }) as Array<Record<string, unknown>>;
      const jobs: EmailJob[] = [];
      for (const row of rows) {
        const { data, error } = await (await db()).from("email_preferences").select("unsubscribe_token").eq("uid", row["uid"]).single();
        if (error) throw new Error("Mailing token unavailable");
        jobs.push({ id: String(row["id"]), uid: String(row["uid"]), email: String(row["email"]),
          step: Number(row["step"]) as EmailJob["step"], attempts: Number(row["attempts"]), unsubscribeToken: data.unsubscribe_token as string });
      }
      return jobs;
    },
    async eligible(id, now) { return await rpc("email_is_eligible", { p_id: id, p_now: now }) === true; },
    async finish(job, result, now) {
      const database = await db();
      const values = "providerId" in result
        ? { status: "sent", provider_id: result.providerId, sent_at: now, lease_until: null, last_error: null }
        : { status: result.retry && job.attempts < 5 ? "pending" : "failed", lease_until: null,
          due_at: now + Math.min(6 * 3600_000, 60_000 * 2 ** job.attempts), last_error: result.code };
      // A concurrent unsubscribe cancels future work, but an already accepted send
      // still needs its provider id so a later bounce can suppress the address.
      let query = database.from("email_jobs").update(values).eq("id", job.id);
      if (!("providerId" in result)) query = query.eq("status", "sending");
      const { error } = await query;
      if (error) throw new Error("Mailing acknowledgement failed");
      if ("providerId" in result) await rpc("email_reconcile", { p_provider_id: result.providerId });
    },
    async event(id, type, providerId, now) {
      await rpc("email_apply_event", { p_id: id, p_type: type, p_provider_id: providerId, p_now: now });
    },
  };
}
