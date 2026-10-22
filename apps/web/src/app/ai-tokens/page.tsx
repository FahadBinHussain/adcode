import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import AiTokens from "./AiTokens";
import "./ai-tokens.css";

export const metadata: Metadata = pageMetadata({
  path: "/ai-tokens",
  title: "Buy AI tokens",
  socialTitle: "Buy AI tokens for ADCode",
  description: "Heabsy models in ADCode include 10M free tokens a week. Buy more when you need them: $10 for 50M tokens, $25 for 140M, $50 for 300M. Tokens never expire.",
});

/** Rendered on the server, so the heading and the offer are there before anyone signs in. */
export function AiTokensHeading() {
  return (
    <header className="ai-tokens-head">
      <h1>AI tokens</h1>
      <p>
        Heabsy&apos;s models in ADCode - GLM 5.3 Flash, Qwen 3.8 and Mimo - include 10M free tokens every week.
        Buy more to keep using them through a heavy week. Tagflow AI stays free with no weekly limit.
      </p>
    </header>
  );
}

export default function Page() {
  return (
    <main className="ai-tokens">
      <AiTokensHeading />
      <AiTokens />
    </main>
  );
}
