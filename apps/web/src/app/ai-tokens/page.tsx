import type { Metadata } from "next";
import AiTokens from "./AiTokens";
import "./ai-tokens.css";

export const metadata: Metadata = {
  title: "Buy AI tokens · ADCode",
  description: "Heabsy models in ADCode include 10M free tokens a week. Buy more: $10 for 50M tokens, $25 for 140M, $50 for 300M.",
  alternates: { canonical: "/ai-tokens" },
};

export default function Page() {
  return <AiTokens />;
}
