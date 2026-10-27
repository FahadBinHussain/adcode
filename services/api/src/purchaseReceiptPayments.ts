/** The paid-charge facts needed for a receipt, never card details or a webhook email. */
export interface ReceiptPayment {
  paymentId: string;
  webhookId: string;
  subscriptionId: string | null;
  orderId: string | null;
  customerId: string;
  amountMinor: number;
  currency: string;
  paidAt: number;
  receivedAt: number;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const identifier = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\s\u0000-\u001f]/.test(value) ? value : null;

/** Call only after verifying the raw Dodo signature. A checkout or subscription status is not a charge. */
export function parseReceiptPayment(raw: unknown, webhookId: string, receivedAt: number): ReceiptPayment | null {
  const envelope = record(raw), inner = record(envelope?.["data"]);
  const data = record(inner?.["object"]) ?? inner;
  if (envelope?.["type"] !== "payment.succeeded" || !data || !identifier(webhookId)) return null;
  if (data["status"] !== undefined && data["status"] !== "succeeded") return null;
  const paymentId = identifier(data["payment_id"]);
  const customerId = identifier(record(data["customer"])?.["customer_id"]);
  const subscriptionId = identifier(data["subscription_id"]);
  // ADCode's checkout creates a single subscription or one one-time order. Do not
  // mislabel a newer multi-subscription/cart payment as one of those receipts.
  if (data["is_multi_subscription"] === true || data["is_update_payment_method"] === true) return null;
  const orderId = identifier(record(data["metadata"])?.["orderId"]);
  const amountMinor = data["total_amount"], currency = data["currency"];
  const paidAt = typeof envelope["timestamp"] === "string" ? Date.parse(envelope["timestamp"]) : NaN;
  if (!paymentId || !customerId || (!subscriptionId && !orderId) ||
      typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor < 0 ||
      typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency) ||
      !Number.isSafeInteger(paidAt) || paidAt <= 0 || paidAt > receivedAt + 300_000) return null;
  return { paymentId, webhookId, subscriptionId, orderId, customerId, amountMinor, currency, paidAt, receivedAt };
}
