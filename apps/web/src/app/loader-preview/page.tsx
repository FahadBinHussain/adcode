import { AdcodeLoader } from "@/components/AdcodeLoader";

/** Temporary preview route for the custom loading component. Safe to delete. */
export default function LoaderPreviewPage() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "70svh", padding: 48 }}>
      <AdcodeLoader />
    </main>
  );
}
