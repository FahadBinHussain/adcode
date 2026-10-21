import { Html, Head, Preview, Body, Container, Section, Heading, Text, Button, Link, Hr, render } from "react-email";
import type { AnnouncementJob } from "@adcode/api/src/mailing.ts";

/**
 * A release, new docs, a status-page update, or a model email - the same quiet card as the return campaign
 * (Reengagement.tsx), with the words taken from the announcement's snapshot. Status updates say
 * where things stand in plain words and link the status page; releases and docs link the page
 * they announce. The footer says which yes this email answers and carries the matching
 * unsubscribe link.
 */
const font = "Arial, Helvetica, sans-serif";
const paragraph = { fontFamily: font, fontSize: "16px", lineHeight: "27px", color: "#56534e" };

const STATUS_WORDS: Record<string, string> = {
  investigating: "Investigating",
  identified: "Cause found",
  monitoring: "Fix in place, watching",
  resolved: "Resolved",
};

function copyFor(job: AnnouncementJob) {
  const { topic, payload } = job;
  if (topic === "status") {
    return {
      eyebrow: `Status update · ${STATUS_WORDS[payload.status ?? ""] ?? "Update"}`,
      action: "Open the status page",
      why: "You asked ADCode to email you about outages and fixes. This email stops only those.",
      unsubscribe: "Stop status emails",
    };
  }
  if (topic === "models") {
    const report = payload.highlights !== undefined && payload.highlights.length > 0;
    return {
      eyebrow: report ? "Model performance" : "New free model",
      action: report ? "See live model status" : "See every free model",
      why: "You asked ADCode to email you about its AI models. This email stops only those.",
      unsubscribe: "Stop model emails",
    };
  }
  const docs = payload.url.includes("/docs/");
  return {
    eyebrow: docs ? "New in the docs" : "What's new in ADCode",
    action: docs ? "Read the guide" : "See what changed",
    why: "You opted in to ADCode product updates and project ideas. You can leave this list whenever you like.",
    unsubscribe: "Unsubscribe",
  };
}

function tracked(url: string, job: AnnouncementJob): string {
  const target = new URL(url);
  target.searchParams.set("utm_source", "resend");
  target.searchParams.set("utm_medium", "email");
  target.searchParams.set("utm_campaign", job.topic === "product" ? "adcode-announcement" : `adcode-${job.topic}`);
  return target.href;
}

export function AnnouncementEmail({ job, unsubscribeUrl, postalAddress }: { job: AnnouncementJob; unsubscribeUrl: string; postalAddress: string }) {
  const copy = copyFor(job);
  const { payload } = job;
  return (
    <Html lang="en">
      <Head />
      <Body style={{ backgroundColor: "#f1efea", margin: "0", padding: "0", fontFamily: font }}>
        <Preview>{payload.summary.slice(0, 140)}</Preview>
        <Container style={{ maxWidth: "580px", width: "100%", margin: "0 auto" }}>
          <Section style={{ padding: "32px 24px 20px" }}>
            <Text style={{ fontFamily: font, fontSize: "20px", lineHeight: "28px", fontWeight: 700, letterSpacing: "-0.8px", color: "#25241f", margin: "0" }}>adcode<span style={{ color: "#81775e" }}>.</span></Text>
          </Section>
          <Section style={{ backgroundColor: "#fcfbf7", border: "1px solid #dedbd2", borderRadius: "16px", overflow: "hidden" }}>
            <Section style={{ backgroundColor: "#24231f", padding: "34px 28px" }}>
              <Text style={{ fontFamily: font, fontSize: "11px", lineHeight: "18px", letterSpacing: "2px", color: "#cec7b5", textTransform: "uppercase", margin: "0 0 16px" }}>{copy.eyebrow}</Text>
              <Heading style={{ fontFamily: font, fontSize: "30px", lineHeight: "37px", fontWeight: 600, letterSpacing: "-1px", color: "#f5f1e7", margin: "0", maxWidth: "470px" }}>{payload.title}</Heading>
            </Section>
            <Section style={{ padding: "28px" }}>
              <Text style={{ ...paragraph, margin: "0 0 20px", whiteSpace: "pre-line" }}>{payload.summary}</Text>
              {payload.highlights !== undefined && payload.highlights.length > 0 && (
                <Section style={{ backgroundColor: "#efede5", borderRadius: "8px", padding: "16px 18px", margin: "0 0 24px" }}>
                  {payload.highlights.map((line) => <Text key={line} style={{ ...paragraph, color: "#33312b", margin: "0 0 6px" }}>· {line}</Text>)}
                </Section>
              )}
              <Button href={tracked(payload.url, job)} style={{ backgroundColor: "#292820", border: "1px solid #292820", borderRadius: "8px", color: "#fcfbf7", fontFamily: font, fontSize: "15px", lineHeight: "22px", fontWeight: 600, textAlign: "center", textDecoration: "none", padding: "14px 24px", boxSizing: "border-box" }}>{copy.action} &rarr;</Button>
            </Section>
          </Section>
          <Section style={{ padding: "24px 24px 36px" }}>
            <Hr style={{ borderColor: "#d9d5cb", margin: "0 0 14px" }} />
            <Text style={{ ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "0 0 8px", color: "#666159" }}>{copy.why}</Text>
            <Text style={{ ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "0 0 8px", color: "#666159" }}>ADCode by Bluethenics<br />{postalAddress}</Text>
            <Link href={unsubscribeUrl} style={{ fontFamily: font, fontSize: "12px", lineHeight: "24px", color: "#4c493e", textDecoration: "underline" }}>{copy.unsubscribe}</Link>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderAnnouncement(job: AnnouncementJob, unsubscribeUrl: string, postalAddress: string) {
  const copy = copyFor(job);
  const html = await render(<AnnouncementEmail job={job} unsubscribeUrl={unsubscribeUrl} postalAddress={postalAddress} />);
  const text = [
    copy.eyebrow, job.payload.title, job.payload.summary,
    ...(job.payload.highlights ?? []).map((line) => "- " + line),
    copy.action + ": " + tracked(job.payload.url, job),
    copy.why, "ADCode by Bluethenics", postalAddress, copy.unsubscribe + ": " + unsubscribeUrl,
  ].join("\n\n");
  return { subject: job.subject, html, text };
}
