import { AdcodeLoader } from "@/components/AdcodeLoader";

/**
 * The instant loading state for every route below the root layout: the ADCode
 * ribbon mark with the login page's sweep of light across it. Layouts stay
 * interactive while a page streams in, so this only replaces the content area.
 */
export default function Loading() {
  return <AdcodeLoader fill />;
}
