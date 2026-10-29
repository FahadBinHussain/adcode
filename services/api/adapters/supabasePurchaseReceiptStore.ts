import type { SupabaseClient } from "@supabase/supabase-js";
import type { PurchaseReceiptJob, PurchaseReceiptKind, PurchaseReceiptMail, PurchaseReceiptStore } from "../src/purchaseReceipts.ts";

export function createSupabasePurchaseReceiptStore(): PurchaseReceiptStore {
  let client: SupabaseClient | undefined;
  async function rpc(name: string, args: Record<string, unknown>) {
    if (!client) {
      const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
      if (!url || !key) throw new Error("Purchase receipt storage unavailable");
      const { createClient } = await import("@supabase/supabase-js");
      client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    }
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error("Purchase receipt operation failed: " + name);
    return data;
  }
  return {
    async prepare(now) { await rpc("email_prepare_purchase_receipts", { p_now: now }); },
    async claim(now, limit) {
      const rows = await rpc("email_claim_purchase_receipts", { p_now: now, p_limit: limit }) as {
        id: string; lease_token: string; kind: string; email: string; name: string; details: PurchaseReceiptJob["details"];
      }[];
      return rows.map(({ id, lease_token, kind, email, name, details }) => ({
        id, leaseToken: lease_token, kind: kind as PurchaseReceiptKind, email, name, details,
      }));
    },
    async eligible(id, leaseToken, now) { return await rpc("email_purchase_receipt_eligible", { p_id: id, p_lease: leaseToken, p_now: now }) === true; },
    async payload(id, leaseToken, proposed, now) {
      return await rpc("email_purchase_receipt_payload", { p_id: id, p_lease: leaseToken, p_payload: proposed, p_now: now }) as PurchaseReceiptMail | null;
    },
    async finish(id, leaseToken, result, now) {
      await rpc("email_finish_purchase_receipt", "providerId" in result
        ? { p_id: id, p_lease: leaseToken, p_provider_id: result.providerId, p_retry: false, p_code: null, p_now: now }
        : { p_id: id, p_lease: leaseToken, p_provider_id: null, p_retry: result.retry, p_code: result.code, p_now: now });
      // The acknowledgement has committed. Reconciliation locks suppressions and
      // possibly other jobs, so it must never run while the ACK owns a job lock.
      // Its durable flag is retried by prepare if this separate RPC fails.
      if ("providerId" in result) await rpc("email_reconcile_purchase_receipt", { p_id: id });
    },
  };
}
