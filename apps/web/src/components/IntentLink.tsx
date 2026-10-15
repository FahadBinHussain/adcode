"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * `next/link` that prefetches when somebody shows they might follow it - a pointer over
 * it, a finger on it, keyboard focus - instead of whenever it scrolls into view.
 *
 * The default fetched every visible link in the background, twice each (route tree, then
 * data), and the nav and footer alone put about fifteen on every page: 15-30 requests per
 * view, each one a render on the Worker, all competing with the page that was actually
 * opened. Measured on the live site on 2026-10-15. Intent still prefetches early enough
 * that the click lands on a page that is already on its way.
 *
 * Used everywhere but the admin panel, which keeps the plain `next/link`: one person, a
 * handful of tabs, and there an instant switch is the point.
 */
export default function IntentLink({ prefetch, onMouseEnter, onTouchStart, onFocus, ...props }: ComponentProps<typeof Link>) {
  const [wanted, setWanted] = useState(false);

  return (
    <Link
      {...props}
      prefetch={prefetch === false || !wanted ? false : (prefetch ?? null)}
      onMouseEnter={(event) => {
        setWanted(true);
        onMouseEnter?.(event);
      }}
      onTouchStart={(event) => {
        setWanted(true);
        onTouchStart?.(event);
      }}
      onFocus={(event) => {
        setWanted(true);
        onFocus?.(event);
      }}
    />
  );
}
