# Production quality tools

Adcode now has a **Quality** section in Tools with three built-in tools:

| Tool | What it checks | Available to |
| --- | --- | --- |
| Inspect project checks | Manifests, dependencies, package manager, available type/lint/test/build scripts, and missing checks. Nothing is executed. | Chat and saved agents, including read-only agents |
| Run project checks | Up to four existing package scripts, each real exit code and output, with one shared time budget and cancellation. Does not install dependencies itself. | Chat and agents allowed to run it |
| Audit a page | A real Chromium page at phone, tablet and desktop sizes; axe-core accessibility findings, overflow, broken images, runtime/network errors and reduced-motion behavior. | Chat |

The browser audit defaults to text reports at 390×844, 768×1024 and 1440×900. Use Look at pages for screenshots and to click through a flow, including with reduced motion enabled. The audit starts each size at the same URL and repeats any supplied actions. Avoid actions that create repeated records or submit irreversible operations.

Agents work in an isolated workspace. Code checks run there. In review mode, the built-in live preview serves the applied project; to verify staged UI changes, start a local server in the active workspace and supply its local URL to the browser tools.

## Professional design and motion

With the design guidance setting enabled, the chat and agents are directed to the compact `production-quality` skill before interface work. It covers an intentional visual direction, semantic tokens, typography and spacing, complete interaction states, accessible controls and visual review. Its motion reference covers consistent timing, interruptible transitions, reduced motion and performance. Its release reference covers real flows, service configuration and evidence before a production handoff.

The existing visual taste and redesign skills remain available for deeper design direction. Project conventions and the user's brief take priority; existing plain HTML projects keep their stack. References load only when needed.

## Better edit recovery

When a replacement doesn't match, Adcode leaves the file unchanged and returns an excerpt plus a precise recovery read. File reads can omit line numbers so the model can copy exact text, and large reads page within a bounded output size to protect context. Try again after an edit loop asks the model to re-read and correct the replacement. The retry limit still prevents endless identical failures, and the failure retains the actual tool error.

## What the results mean

Missing, cancelled, timed-out or unrun checks are unverified. An accessibility scan reports violations and rules requiring manual review; a clean scan does not establish complete accessibility. Keyboard use, screen-reader behavior, visual quality, real integrations and release configuration still need verification. Browser timings describe the local development page and are not a production performance score.

These desktop tools require the updated desktop build. Publishing installers and update metadata is a separate release step.
