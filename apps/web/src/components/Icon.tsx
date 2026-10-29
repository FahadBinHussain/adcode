import { createElement } from "react";
import type { IconNode } from "lucide";

/**
 * A Lucide icon, drawn inline. The site's one icon library, the same set the desktop uses,
 * so an arrow or a tick looks the same everywhere and never depends on a font's emoji.
 * Decorative by default: the text beside it carries the meaning.
 */
export function Icon({ node, size = "1em", strokeWidth = 2, className, label }: { node: IconNode; size?: number | string; strokeWidth?: number; className?: string; label?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className === undefined ? "icon" : `icon ${className}`}
      {...(label === undefined ? { "aria-hidden": true, focusable: false } : { role: "img", "aria-label": label })}
    >
      {node.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }))}
    </svg>
  );
}
