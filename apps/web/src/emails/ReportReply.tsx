import { Html, Head, Preview, Body, Container, Section, Text, Hr, render } from "react-email";

/**
 * An administrator's answer to one person's report: their words, the report it answers, and a
 * reply-to that reaches a person. Plain on purpose - it is a letter, not a campaign - so there is
 * no unsubscribe list to leave and nothing to sell.
 */
const font = "Arial, Helvetica, sans-serif";
const paragraph = { fontFamily: font, fontSize: "16px", lineHeight: "27px", color: "#33312b" };

export interface ReportReplyProps {
  reportTitle: string;
  reportedAt: number;
  message: string;
}

const day = (at: number): string => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function ReportReplyEmail({ reportTitle, reportedAt, message }: ReportReplyProps) {
  return (
    <Html lang="en">
      <Head />
      <Body style={{ backgroundColor: "#f1efea", margin: "0", padding: "0", fontFamily: font }}>
        <Preview>{message.slice(0, 140)}</Preview>
        <Container style={{ maxWidth: "580px", width: "100%", margin: "0 auto" }}>
          <Section style={{ padding: "32px 24px 20px" }}>
            <Text style={{ fontFamily: font, fontSize: "20px", lineHeight: "28px", fontWeight: 700, letterSpacing: "-0.8px", color: "#25241f", margin: "0" }}>adcode<span style={{ color: "#81775e" }}>.</span></Text>
          </Section>
          <Section style={{ backgroundColor: "#fcfbf7", border: "1px solid #dedbd2", borderRadius: "16px", padding: "28px" }}>
            <Text style={{ ...paragraph, fontSize: "13px", lineHeight: "20px", color: "#666159", margin: "0 0 18px" }}>About your report from {day(reportedAt)}: “{reportTitle}”</Text>
            <Text style={{ ...paragraph, margin: "0 0 20px", whiteSpace: "pre-line" }}>{message}</Text>
            <Text style={{ ...paragraph, margin: "0" }}>— The ADCode team</Text>
          </Section>
          <Section style={{ padding: "24px 24px 36px" }}>
            <Hr style={{ borderColor: "#d9d5cb", margin: "0 0 14px" }} />
            <Text style={{ ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "0", color: "#666159" }}>You are getting this because you sent ADCode a report from the app. Reply to this email to answer - a person reads it.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderReportReply(props: ReportReplyProps) {
  const html = await render(<ReportReplyEmail {...props} />);
  const text = [`About your report from ${day(props.reportedAt)}: "${props.reportTitle}"`, props.message, "- The ADCode team",
    "You are getting this because you sent ADCode a report from the app. Reply to this email to answer - a person reads it."].join("\n\n");
  return { subject: `Re: ${props.reportTitle}`.slice(0, 200), html, text };
}
