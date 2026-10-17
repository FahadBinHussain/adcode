"use client";

import { useId, useState, type ReactNode } from "react";

/** Desktop keeps its rail; phones open the same links only when they need them. */
export function DocsNavigation({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <button className="docs-mobile-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span>Browse documentation</span>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <div className="docs-navigation-content" id={id} data-open={open} onClick={(event) => {
        if ((event.target as Element).closest("a")) setOpen(false);
      }}>
        {children}
      </div>
      <noscript><style>{".docs-frame .docs-mobile-toggle{display:none}.docs-frame .docs-navigation-content{display:grid!important}"}</style></noscript>
    </>
  );
}
