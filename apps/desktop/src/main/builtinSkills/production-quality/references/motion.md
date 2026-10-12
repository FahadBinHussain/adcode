# Motion that earns its place

Choose motion for a reason: feedback after an action, continuity when content moves, focus entering a dialog, or explanation of a change. Keep one coherent motion language. Treat these durations as starting points for the product, not laws:

- Hover, pressed and focus feedback: roughly 100–160 ms.
- Menus, tooltips and small reveals: roughly 150–220 ms.
- Dialogs and meaningful layout transitions: roughly 200–300 ms.
- Rare editorial entrances may take longer; never delay a usable control or reading content.

Prefer a restrained ease-out for entering and ease-in for leaving. Match velocity across related transitions. Use short distances, opacity and transforms; avoid `transition: all`, animating large filters or shadows, and continuous decorative loops. Avoid layout thrashing and do not hide content until JavaScript animates it into view.

Animation must be interruptible. Rapid clicks should not queue stale transitions; closing and reopening a dialog must leave it interactive. Keep focus in the right place while elements enter or leave. Do not remove an element that currently has focus without moving focus meaningfully.

Honor `prefers-reduced-motion`: remove parallax, sweeping translations, zooms, looping decoration and long entrances. Preserve the state change with instant updates or a brief fade when appropriate. For JavaScript animation, use `matchMedia` and react when the preference changes. Keep essential progress feedback readable without depending on motion; use text or determinate progress where available.

Use CSS for simple transitions and the project's existing animation library for complex sequencing or gestures. Add a dependency only when it solves a concrete need and fits the bundle budget. Scroll effects must not hijack native scrolling. Keep touch behavior, keyboard navigation and reduced motion working.

Verify normal motion with view_page, then reduced motion with view_page reduced_motion: true or audit_page. Inspect both open and closed states and test repeated actions. Remaining active animations under reduced motion need review; a necessary loading indicator may be appropriate. Local timing measurements are diagnostics, not a Core Web Vitals or production benchmark.
