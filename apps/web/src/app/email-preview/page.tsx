import type { Metadata } from "next";
import { renderReengagement } from "@/emails/Reengagement";

export const metadata: Metadata = { title: "ADCode email previews", robots: { index: false, follow: false } };
export default async function EmailPreview() {
  const previews = await Promise.all(([0, 1, 2] as const).map((step) =>
    renderReengagement(step, "https://adcode.bluethenics.com/dashboard#email-preferences", "Postal address required before sending")));
  return (
    <main style={{ maxWidth: 1220, margin: "0 auto", padding: "48px 20px" }}>
      <p className="eyebrow">ADCode mail</p>
      <h1 style={{ fontSize: "clamp(30px, 5vw, 48px)", margin: "12px 0" }}>A thoughtful way back.</h1>
      <p style={{ maxWidth: 650, color: "var(--muted)", lineHeight: 1.7 }}>Starts after 14 days away, with follow-ups 4 and 10 days later. Sending is disabled. Only verified users who opt in are eligible.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 20, marginTop: 32 }}>
        {previews.map((mail, index) => <section key={mail.subject} style={{ minWidth: 0 }}>
          <p style={{ fontSize: 13, marginBottom: 12 }}>Email {index + 1} · {mail.subject}</p>
          <iframe title={"Email " + (index + 1) + " preview"} srcDoc={mail.html} sandbox="" style={{ width: "100%", height: 1050, border: "1px solid var(--border)", borderRadius: 12, background: "#f1efea" }} />
        </section>)}
      </div>
    </main>
  );
}
