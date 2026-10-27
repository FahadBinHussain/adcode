import { describe, it, expect } from "vitest";
import { renderReengagement } from "../src/emails/Reengagement";
import { renderAdvertiserWelcome } from "../src/emails/AdvertiserWelcome";

describe("ADCode email compatibility", () => {
  it("renders an advertiser setup email with escaped personalization and useful actions", async () => {
    const mail = await renderAdvertiserWelcome("<script>bad</script>", "https://adcode.test/portal?utm_campaign=advertiser-welcome", "10 Example Road, Example City");
    expect(mail.html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(mail.html).toContain("https://adcode.test/portal?utm_campaign=advertiser-welcome");
    expect(mail.html).not.toMatch(/display:\s*(flex|grid)|<script|<svg/);
    expect(mail.html.match(/<h1\b/g)).toHaveLength(1);
    expect(mail.text).toContain("Reply with what you are promoting");
    expect(mail.text).toContain("does not subscribe you to marketing");
    expect(Buffer.byteLength(mail.html)).toBeLessThan(102_000);
  });
  it.each([0, 1, 2] as const)("renders step %s with working actions, a real footer, and a plain text version", async (step) => {
    const mail = await renderReengagement(step, "https://adcode.test/unsubscribe?token=example", "Example Business, 10 Example Road");
    expect(mail.html).toContain("<!DOCTYPE");
    expect(mail.html).toContain("<table");
    expect(mail.html).toContain("https://adcode.test/unsubscribe?token=example");
    expect(mail.html).toContain("Example Business, 10 Example Road");
    expect(mail.html).toContain("utm_campaign=adcode-return-v1");
    expect(mail.text).toContain("Unsubscribe: https://adcode.test/unsubscribe?token=example");
    expect(mail.html).not.toMatch(/display:\s*(flex|grid)|<script|<svg/);
    expect(Buffer.byteLength(mail.html)).toBeLessThan(102_000);
  });
  it("escapes footer content", async () => {
    expect((await renderReengagement(0, "https://adcode.test/unsubscribe", "<script>bad</script>")).html).toContain("&lt;script&gt;");
  });
});
