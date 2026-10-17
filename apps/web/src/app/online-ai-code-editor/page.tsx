import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingArticle } from "@/components/LandingArticle";
import { JsonLd } from "@/components/JsonLd";
import { getLanding, landingMetadata } from "@/lib/landings";
import { webApplication } from "@/lib/schema";

const page = getLanding("online-ai-code-editor");

export const metadata: Metadata = page === null ? {} : landingMetadata(page);

export default function OnlineAiCodeEditorPage() {
  if (page === null) notFound();
  return <><JsonLd data={webApplication()} /><LandingArticle page={page} /></>;
}
