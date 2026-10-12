---
name: production-quality
description: Build distinctive, usable products with a coherent visual system, purposeful motion, complete interaction states, and evidence from code and browser checks.
---

# Production quality

Follow the user's brief, existing project conventions and tool permissions. Keep its stack. Use this compact workflow for a new interface or a redesign; read the references only when needed.

## Understand before designing

Read project instructions and call inspect_project. Identify the primary user, their main task, the page's purpose and what must actually work. Inspect existing screens and components before choosing a direction. For an existing product, preserve recognizable patterns and fix friction. Make routine choices yourself; ask only when a missing preference materially changes the product.

Choose a concrete visual direction appropriate to the domain: for example, quiet editorial typography for a reading product, dense clear hierarchy for an operations tool, or expressive art direction for a creative brand. Use the existing design system when present. Read design-taste-frontend for deeper visual direction or redesign-existing-projects for a larger redesign. Do not mistake an unusual layout for a usable product.

## Define a small visual system

- Establish semantic tokens for surfaces, text, borders, accent, success, warning and error; use them consistently, including dark mode. Use a spacing scale, a few radii and one elevation language.
- Create hierarchy with type size, weight, whitespace and placement. Choose a readable body face and, if useful, a complementary display face with available licensing and fallbacks. Avoid making every element bold, every section a card or every line an explanatory paragraph.
- Use an intentional grid, content width and density. Align controls, labels and baselines. Prioritize the user's primary action; make secondary actions quieter and destructive actions distinguishable.
- Use meaningful product copy and real data from the project. Do not invent testimonials, customer logos, performance claims, statistics or fake integrations. Use honest empty states and representative sample data only when clearly identified.
- Choose imagery, icons and composition for this product. Do not default to a gradient hero, floating blobs, oversized rounded cards, gratuitous glass, emoji icons or repeated three-column feature grids. Those choices may fit a brief; they must earn their place.

## Finish behavior as carefully as appearance

Implement the requested workflow end to end. Check loading, empty, success, invalid input, error, disabled and offline states where relevant. Forms need labels, validation and recoverable errors; dialogs need focus management and Escape; async actions need progress and duplicate-submit protection. Keep the user's input on a recoverable failure. Every visible control must do something useful.

Use native semantics first. Provide accessible names for icon controls, visible keyboard focus, sufficient contrast, sensible tab order and usable touch targets. Do not hide essential actions on hover. Design for narrow widths, long labels, zoom and content overflow rather than simply shrinking the desktop screen. Prefer progressive disclosure to walls of help text.

For motion, read references/motion.md. Animation should explain state or direct attention and keep the interface responsive. Respect reduced motion. Do not animate every item or add a framework just for a small transition.

## Verify the actual result

Run the relevant existing checks with run_project_checks, or native checks with run_command. Missing tests or build scripts are unverified, not passes. Fix failures introduced by the change; describe unrelated blockers accurately.

For a UI, start a local server for the active workspace. In review mode, use the sandbox dev-server URL to verify staged changes; the default live preview serves the applied project. Use view_page to inspect screenshots at phone and desktop sizes and click/type through the primary flow. Use audit_page to find accessibility, overflow, runtime and reduced-motion issues. Read its findings and repair them; never claim the automated scan establishes full accessibility or production performance. Board agents without browser tools should run code checks and identify the remaining browser review for the chat.

Look at the result and make one focused refinement pass: hierarchy, alignment, copy density, spacing, contrast, action prominence and visual consistency. Testing code alone does not verify visual polish.

Before a production handoff, read references/release.md. State what changed, which checks really ran, what remains unverified, and how to run the product. Do not claim it is production ready if critical flows, real service configuration or release checks remain incomplete.
