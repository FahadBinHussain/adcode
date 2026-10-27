import type { Metadata } from "next";
import { pricingOffer } from "@/lib/pricingOffer";
import { pageMetadata } from "@/lib/seo";
import { PricingContent } from "./PricingContent";
import "./pricing.css";

export const metadata: Metadata = pageMetadata({
  path: "/pricing",
  title: "Pricing",
  socialTitle: "ADCode pricing: free editor, optional AI plans",
  description: "Start with ADCode's free editor and included AI. Compare Weekly $3, Monthly $9 and Pro $19 plans, or buy one-time token packs that never expire.",
});

export const revalidate = 60;


export default async function PricingPage() {
  return <PricingContent offer={await pricingOffer()} />;
}
