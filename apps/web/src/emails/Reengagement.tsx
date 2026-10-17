import { Html, Head, Preview, Body, Container, Section, Heading, Text, Button, Link, Hr, render } from "react-email";

export const REENGAGEMENT_CONTENT = [
  {
    subject: "Your next build starts here",
    preview: "Free AI, a focused workspace, and room for your next idea.",
    eyebrow: "A fresh start",
    title: "That idea is still worth building.",
    body: "A small tool. A personal website. The project you keep coming back to. Give it a little space in ADCode.",
    detail: "Start with free AI assistance, work alongside agents, and keep moving in a workspace made for building. You can open ADCode in your browser.",
    action: "Open in browser",
    destination: "https://web.bluethenics.com/",
    note: "Prefer your own machine? ADCode is also available for Windows and Linux.",
  },
  {
    subject: "One small project. A useful first step.",
    preview: "A simple prompt to turn a blank workspace into something yours.",
    eyebrow: "An idea to get you going",
    title: "Start smaller. Make something yours.",
    body: "You do not need a perfect plan to begin. Open a workspace and try this:",
    detail: "Build a clean personal portfolio with an about section, three project cards, and a contact form. Keep it simple and make it work well on phones.",
    action: "Start a project",
    destination: "https://web.bluethenics.com/",
    note: "Ask ADCode to work through it one step at a time. Review each change and make it your own.",
  },
  {
    subject: "Ready when you are",
    preview: "One last note in this series, and an open door to your next build.",
    eyebrow: "Your next chapter",
    title: "Come back when the idea does.",
    body: "This is the last reminder in this series. Whenever you are ready, ADCode is here to help you turn a small idea into a working project.",
    detail: "Build with free AI assistance. Eligible sponsored activity can also earn you a share of ad revenue. Earnings depend on available ads and verified activity; they are never guaranteed.",
    action: "Explore ADCode",
    destination: "https://adcode.bluethenics.com/",
    note: "Something getting in the way? Reply to this email and tell us what would help.",
  },
] as const;

export interface ReengagementEmailProps {
  step: 0 | 1 | 2;
  unsubscribeUrl: string;
  postalAddress: string;
}
const font = "Arial, Helvetica, sans-serif";
const paragraph = { fontFamily: font, fontSize: "16px", lineHeight: "27px", color: "#56534e" };
export function ReengagementEmail({ step, unsubscribeUrl, postalAddress }: ReengagementEmailProps) {
  const copy = REENGAGEMENT_CONTENT[step];
  const target = new URL(copy.destination);
  target.searchParams.set("utm_source", "resend");
  target.searchParams.set("utm_medium", "email");
  target.searchParams.set("utm_campaign", "adcode-return-v1");
  target.searchParams.set("utm_content", "step-" + (step + 1));
  return (
    <Html lang="en">
      <Head />
      <Body style={{ backgroundColor: "#f1efea", margin: "0", padding: "0", fontFamily: font }}>
        <Preview>{copy.preview}</Preview>
        <Container style={{ maxWidth: "580px", width: "100%", margin: "0 auto" }}>
          <Section style={{ padding: "32px 24px 20px" }}>
            <Text style={{ fontFamily: font, fontSize: "20px", lineHeight: "28px", fontWeight: 700, letterSpacing: "-0.8px", color: "#25241f", margin: "0" }}>adcode<span style={{ color: "#81775e" }}>.</span></Text>
          </Section>
          <Section style={{ backgroundColor: "#fcfbf7", border: "1px solid #dedbd2", borderRadius: "16px", overflow: "hidden" }}>
            <Section style={{ backgroundColor: "#24231f", padding: "38px 28px" }}>
              <Text style={{ fontFamily: font, fontSize: "11px", lineHeight: "18px", letterSpacing: "2px", color: "#cec7b5", textTransform: "uppercase", margin: "0 0 18px" }}>{copy.eyebrow}</Text>
              <Heading style={{ fontFamily: font, fontSize: "36px", lineHeight: "42px", fontWeight: 600, letterSpacing: "-1.4px", color: "#f5f1e7", margin: "0", maxWidth: "450px" }}>{copy.title}</Heading>
            </Section>
            <Section style={{ padding: "28px" }}>
              <Text style={{ ...paragraph, margin: "0 0 20px" }}>{copy.body}</Text>
              <Text style={{ ...paragraph, color: step === 1 ? "#33312b" : "#56534e", backgroundColor: step === 1 ? "#efede5" : "transparent", padding: step === 1 ? "18px" : "0", borderRadius: "8px", margin: "0 0 26px" }}>{copy.detail}</Text>
              <Button href={target.href} style={{ backgroundColor: "#292820", border: "1px solid #292820", borderRadius: "8px", color: "#fcfbf7", fontFamily: font, fontSize: "15px", lineHeight: "22px", fontWeight: 600, textAlign: "center", textDecoration: "none", padding: "14px 24px", boxSizing: "border-box" }}>{copy.action} &rarr;</Button>
              <Text style={{ ...paragraph, fontSize: "14px", lineHeight: "23px", margin: "25px 0 0" }}>{copy.note}</Text>
              {step === 0 && <Text style={{ ...paragraph, fontSize: "14px", lineHeight: "23px", margin: "8px 0 0" }}><Link href="https://adcode.bluethenics.com/versions" style={{ color: "#4c493e", textDecoration: "underline" }}>Get the desktop app</Link></Text>}
            </Section>
          </Section>
          <Section style={{ padding: "24px 24px 36px" }}>
            <Text style={{ ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "0 0 12px", color: "#666159" }}>Build for free and earn for the work.</Text>
            <Hr style={{ borderColor: "#d9d5cb", margin: "0 0 14px" }} />
            <Text style={{ ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "0 0 8px", color: "#666159" }}>You opted in to ADCode product updates and project ideas. You can leave this list whenever you like.</Text>
            <Text style={{ ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "0 0 8px", color: "#666159" }}>ADCode by Bluethenics<br />{postalAddress}</Text>
            <Link href={unsubscribeUrl} style={{ fontFamily: font, fontSize: "12px", lineHeight: "24px", color: "#4c493e", textDecoration: "underline" }}>Unsubscribe</Link>
            <Text style={{ ...paragraph, fontSize: "12px", lineHeight: "20px", margin: "8px 0 0", color: "#666159" }}>Free usage has limits. <Link href="https://adcode.bluethenics.com/free-ai-code-editor" style={{ color: "#4c493e", textDecoration: "underline" }}>See how ADCode works</Link></Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
export async function renderReengagement(step: 0 | 1 | 2, unsubscribeUrl: string, postalAddress: string) {
  const copy = REENGAGEMENT_CONTENT[step], html = await render(<ReengagementEmail step={step} unsubscribeUrl={unsubscribeUrl} postalAddress={postalAddress} />);
  const target = new URL(copy.destination);
  target.search = new URLSearchParams({ utm_source: "resend", utm_medium: "email", utm_campaign: "adcode-return-v1", utm_content: "step-" + (step + 1) }).toString();
  const text = [copy.title, copy.body, copy.detail, copy.action + ": " + target.href, copy.note,
    "ADCode by Bluethenics", postalAddress, "You opted in to ADCode product updates and project ideas.",
    "Unsubscribe: " + unsubscribeUrl, "Free usage has limits: https://adcode.bluethenics.com/free-ai-code-editor"].join("\n\n");
  return { subject: copy.subject, html, text };
}
