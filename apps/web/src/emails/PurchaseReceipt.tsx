import { Html, Head, Preview, Body, Container, Section, Heading, Text, Button, Link, Hr, Row, Column, render } from "react-email";
import type { PurchaseReceiptJob } from "@adcode/api/src/purchaseReceipts.ts";

/**
 * A paid purchase, confirmed in the same quiet card as the status mail: dark header,
 * warm paper, one clear action. It is a receipt, not a campaign, so it carries no
 * unsubscribe link and says plainly why the address received it.
 */
const font = "Arial, Helvetica, sans-serif";
const paragraph = { fontFamily: font, fontSize: "16px", lineHeight: "27px", color: "#56534e" };
const footnote = { ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "0 0 8px", color: "#666159" };
const detail = { ...paragraph, fontSize: "14px", lineHeight: "23px", margin: "0 0 5px", color: "#3f3c34", overflowWrap: "anywhere" as const, wordBreak: "break-word" as const };
const button = {
  backgroundColor: "#292820", border: "1px solid #292820", borderRadius: "8px", color: "#fcfbf7",
  fontFamily: font, fontSize: "15px", lineHeight: "22px", fontWeight: 600, textAlign: "center" as const,
  textDecoration: "none", padding: "14px 24px", boxSizing: "border-box" as const,
};

function money(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("Invalid receipt amount");
  const format = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(digits), amount = BigInt(minor);
  const fraction = (amount % scale).toString().padStart(digits, "0");
  // A floating-point division can round away a valid minor unit near 2^53.
  // Intl handles grouping/symbols on the exact whole BigInt; retain the remainder.
  return format.formatToParts(amount / scale).map(part => part.type === "fraction" ? fraction : part.value).join("");
}

function day(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(new Date(ms));
}

function tokenCount(tokens: number): string {
  return `${(tokens / 1_000_000).toLocaleString("en-US")}M`;
}

function copyFor(job: PurchaseReceiptJob) {
  const details = job.details;
  const amount = money(details.amountMinor, details.currency);
  if (details.kind === "plan") {
    return {
      subject: details.amountMinor === 0 ? "Your ADCode plan confirmation" : "Your ADCode plan payment receipt",
      preview: `AI plan payment confirmed — ${amount}.`,
      summary: details.amountMinor === 0 ? "Your AI plan checkout was confirmed with no payment collected." : "Your AI plan payment was received.",
      item: "AI plan payment",
      meta: "Subscription payment",
      subscription: details.subscriptionId,
      referenceLabel: "Payment reference",
      action: "Manage your plan",
      amount,
      paidAt: details.paidAt,
      reference: details.reference,
    };
  }
  if (details.kind === "tokens") {
    return {
      subject: "Your ADCode AI tokens receipt",
      preview: `${tokenCount(details.tokens)} AI tokens payment confirmed — ${amount}.`,
      summary: `Your payment for ${tokenCount(details.tokens)} AI tokens was received.`,
      item: `${tokenCount(details.tokens)} AI tokens`,
      meta: "One-time purchase",
      subscription: "",
      referenceLabel: "Payment reference",
      action: "View your tokens",
      amount,
      paidAt: details.paidAt,
      reference: details.reference,
    };
  }
  return {
    subject: "Your ADCode advertising credit receipt",
    preview: `Advertising credit payment confirmed — ${amount}.`,
    summary: "Your payment for advertising credit was received.",
    item: "Advertising credit",
    meta: "One-time top-up",
    subscription: "",
    referenceLabel: "Payment reference",
    action: "Open your advertiser portal",
    amount,
    paidAt: details.paidAt,
    reference: details.reference,
  };
}

export function PurchaseReceiptEmail({ job, accountUrl, postalAddress }: { job: PurchaseReceiptJob; accountUrl: string; postalAddress: string }) {
  const copy = copyFor(job);
  return (
    <Html lang="en">
      <Head />
      <Body style={{ backgroundColor: "#f1efea", margin: "0", padding: "0", fontFamily: font }}>
        <Preview>{copy.preview}</Preview>
        <Container style={{ maxWidth: "580px", width: "100%", margin: "0 auto" }}>
          <Section style={{ padding: "32px 24px 20px" }}>
            <Text style={{ fontFamily: font, fontSize: "20px", lineHeight: "28px", fontWeight: 700, letterSpacing: "-0.8px", color: "#25241f", margin: "0" }}>
              adcode<span style={{ color: "#81775e" }}>.</span> <span style={{ fontWeight: 400, color: "#81775e", letterSpacing: "0" }}>receipt</span>
            </Text>
          </Section>
          <Section style={{ backgroundColor: "#fcfbf7", border: "1px solid #dedbd2", borderRadius: "16px", overflow: "hidden" }}>
            <Section style={{ backgroundColor: "#24231f", padding: "30px 28px" }}>
              <Text style={{ fontFamily: font, fontSize: "11px", lineHeight: "18px", letterSpacing: "2px", color: "#8fd3ae", textTransform: "uppercase", fontWeight: 700, margin: "0 0 14px" }}>{job.details.amountMinor === 0 ? "No payment collected" : "Payment received"}</Text>
              <Heading as="h1" style={{ fontFamily: font, fontSize: "30px", lineHeight: "37px", fontWeight: 600, letterSpacing: "-0.8px", color: "#f5f1e7", margin: "0" }}>{job.details.amountMinor === 0 ? "Your confirmation" : "Your receipt"}</Heading>
            </Section>
            <Section style={{ padding: "28px" }}>
              <Text style={{ ...paragraph, margin: "0 0 20px" }}>Hi {job.name},</Text>
              <Text style={{ ...paragraph, margin: "0 0 22px" }}>{copy.summary}</Text>

              <Section style={{ backgroundColor: "#f4f1e8", border: "1px solid #dedbd2", borderRadius: "12px", padding: "18px 20px", margin: "0 0 22px" }}>
                <Row>
                  <Column style={{ width: "68%", verticalAlign: "top" }}>
                    <Text style={{ ...paragraph, fontWeight: 700, color: "#292820", margin: "0 0 4px" }}>{copy.item}</Text>
                    <Text style={{ ...paragraph, fontSize: "13px", lineHeight: "20px", color: "#77715f", margin: "0" }}>{copy.meta}</Text>
                  </Column>
                  <Column style={{ width: "32%", verticalAlign: "top", textAlign: "right" }}>
                    <Text style={{ ...paragraph, fontWeight: 700, color: "#292820", margin: "0", overflowWrap: "anywhere", wordBreak: "break-word" }}>{copy.amount}</Text>
                  </Column>
                </Row>
              </Section>

              <Text style={{ ...detail, fontWeight: 700, color: "#292820", margin: "0 0 8px" }}>Payment details</Text>
              <Text style={detail}><strong>Date:</strong> {day(copy.paidAt)}</Text>
              <Text style={detail}><strong>Currency:</strong> {job.details.currency}</Text>
              <Text style={detail}><strong>{copy.referenceLabel}:</strong> {copy.reference}</Text>
              {copy.subscription !== "" && <Text style={detail}><strong>Subscription:</strong> {copy.subscription}</Text>}
              <Text style={{ ...detail, margin: "0 0 22px", overflowWrap: "anywhere" as const }}><strong>Sent to:</strong> {job.email}</Text>

              <Button href={accountUrl} style={button}>{copy.action} &rarr;</Button>

              <Text style={{ ...paragraph, fontSize: "13px", lineHeight: "21px", color: "#77715f", margin: "22px 0 0" }}>
                Dodo Payments is ADCode&apos;s merchant of record. They calculate any applicable tax and provide the official invoice for this payment.
              </Text>
            </Section>
          </Section>
          <Section style={{ padding: "24px 24px 36px" }}>
            <Hr style={{ borderColor: "#d9d5cb", margin: "0 0 14px" }} />
            <Text style={footnote}>This receipt was sent to {job.email} because a payment was confirmed for your ADCode account. It is a transactional message, not marketing.</Text>
            <Text style={footnote}>ADCode by Bluethenics<br />{postalAddress}</Text>
            <Link href="mailto:adcode@bluethenics.com" style={{ fontFamily: font, fontSize: "12px", lineHeight: "24px", color: "#4c493e", textDecoration: "underline" }}>Questions about this receipt?</Link>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

PurchaseReceiptEmail.PreviewProps = {
  job: {
    id: "preview", leaseToken: "preview-lease",
    kind: "plan",
    email: "buyer@example.com",
    name: "Your name",
    details: {
      kind: "plan", subscriptionId: "sub_example", amountMinor: 900, currency: "USD",
      paidAt: Date.parse("2026-10-27T00:00:00Z"), reference: "pay_example",
    },
  },
  accountUrl: "https://adcode.bluethenics.com/ai-tokens",
  postalAddress: "ADCode mailing address",
} satisfies { job: PurchaseReceiptJob; accountUrl: string; postalAddress: string };

export async function renderPurchaseReceipt(job: PurchaseReceiptJob, accountUrl: string, postalAddress: string) {
  const copy = copyFor(job);
  const html = await render(<PurchaseReceiptEmail job={job} accountUrl={accountUrl} postalAddress={postalAddress} />);
  const text = [
    job.details.amountMinor === 0 ? "Your ADCode confirmation" : "Your ADCode receipt",
    `Hi ${job.name},`,
    copy.summary,
    `${copy.item} — ${copy.meta}`,
    `Amount: ${copy.amount}`,
    `Currency: ${job.details.currency}`,
    `Date: ${day(copy.paidAt)}`,
    `${copy.referenceLabel}: ${copy.reference}`,
    `Sent to: ${job.email}`,
    ...(copy.subscription === "" ? [] : [`Subscription: ${copy.subscription}`]),
    `${copy.action}: ${accountUrl}`,
    "Dodo Payments is ADCode's merchant of record. They calculate any applicable tax and provide the official invoice for this payment.",
    `This receipt was sent to ${job.email} because a payment was confirmed for your ADCode account. It is a transactional message, not marketing.`,
    "ADCode by Bluethenics",
    postalAddress,
    "Questions about this receipt? adcode@bluethenics.com",
  ].join("\n\n");
  return { subject: copy.subject, html, text };
}
