# SEO improvements for ADCode and ADCode Web

Status: implemented in source; not deployed. Public checks on 17 October 2026
still show the old marketing content and browser app shell.

## Evidence

The audit uses the original OpenSEO HTML analyzer and issue detectors, pinned to
commit `d7ea7852480601af9bc8870942af8311a410e567`, through a bounded local adapter.
It does not install OpenSEO's hosted application or connect paid services.
See [usage and provenance](seo-open-seo.md).

- All 153 production marketing sitemap pages were fetched. Core metadata,
  canonical URLs, share cards and headings passed. OpenSEO identified a referral
  description reduced to 29 characters and one response exceeding its speed heuristic.
- The browser homepage returned `noindex`, title `ADCode`, no description and no
  initial H1. Its robots and sitemap URLs returned the same HTML shell with status 200.
- Marketing guides and machine-readable introductions described personal API keys
  as necessary, while the current product includes partner AI and browser workspaces.

Raw production baselines are in `artifacts/seo-2026-10-17/`. These are observations
of the deployed version before the fixes, not validation of a deployed release.

## Changes

- Browser public root: descriptive title, description, self-canonical, share cards,
  WebApplication structured data and an initial product explanation. The signed-out
  screen retains the explanation and guide link after JavaScript loads.
- Browser routing: real text robots and XML sitemap responses; only the complete
  production root can be indexed. Preview hosts, account APIs, staging builds and
  other application URLs retain their indexing protections. Unknown HTML fallback
  paths now return 404.
- Marketing: new `/online-ai-code-editor` guide, linked from the existing guide
  system, footer, sitemap and machine-readable versions. Its browser link opens
  `web.bluethenics.com`.
- Content: updated included AI allowances, optional provider keys, browser
  availability and advertising-specific privacy language across guides, comparison
  tables, FAQ and machine-readable summaries. The referral description now fits a
  useful snippet. Changed guide dates reflect this edit.
- Auditing: reusable OpenSEO adapter with pinned source hashes, request/response
  bounds, robots handling and explicit incomplete-coverage reporting. The existing
  production audit now checks canonical and indexing directives on every sitemap page.

## Validation

- Website regression suite: 357 tests passed across 41 files.
- Browser and cloud suite: 64 tests passed across eight files, including a real
  Chromium check of the signed-out screen at desktop and mobile widths.
- Website, desktop/browser and cloud TypeScript checks passed.
- Marketing production build passed, including the new guide.
- Browser production build passed. Its generated HTML was passed through production
  routing and the original OpenSEO checks: all four baseline browser issues are
  resolved locally; robots is text, sitemap is XML, the unauthenticated session API
  returns 401 and a missing page returns 404. Evidence is saved in
  `artifacts/seo-2026-10-17/local-browser-check.json`.
- Audit fixtures cover failed fetch budgets, response truncation, missing or invalid
  sitemaps, nested sitemap limits and indexing/canonical failures.

## Release and measurement

The shared checkout also contains other active website work. Publishing its current
builds would publish those changes together. Review the intended release scope before
deploying both the marketing and browser Workers.

After deployment, verify the new guide returns 200, the browser root returns consistent
`index, follow` metadata and headers, and its robots/sitemap responses have the right
content types. Rerun the audit into a separate dated output directory and compare with
the saved baseline. Verify authenticated APIs remain protected and preview pages remain
outside search.

No keyword-volume, ranking, backlink or traffic increase is claimed. Those measurements
need authorized Search Console or other analytics access. DataForSEO credentials and
paid keyword/backlink requests have not been configured.
