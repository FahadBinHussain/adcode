# Evidence before a production handoff

Scale verification to the product and requested change. Do not add a heavyweight release workflow to a small reversible edit.

For a product intended to ship:

1. Run its actual type, lint, test and build checks. Read package scripts first; do not invent commands or silently install tools. Use native tooling for non-JavaScript projects. Record missing checks as unverified.
2. Exercise the primary user journey and a recoverable failure with realistic input. Cover data persistence, refresh, navigation and empty/loading/error states. Test authentication and permissions when part of the product; client-only validation cannot enforce server access.
3. Inspect phone and desktop layouts, long content, keyboard focus, contrast and reduced motion. Use audit_page for automated findings, then review keyboard operation and visual composition manually.
4. Check required environment variables, real service integration, migrations and deployment instructions without exposing credentials. Keep secrets out of client bundles and source. Do not substitute a mock for a working requested integration and call it complete.
5. Avoid obvious performance waste: oversized original images, unnecessary client JavaScript, unbounded lists, repeated requests and animation that forces layout each frame. Use responsive images and measured diagnostics. Do not advertise a performance score you did not measure in the appropriate environment.
6. For changes that affect stored data or rollout, document the migration and recovery path. Follow the user's authorization for publishing, deploying or destructive actions; a successful build does not authorize a release by itself.

End with a concise handoff containing the behavior delivered, checks and their outcomes, run instructions and any material limitations. A tool returning successfully means it executed; inspect its findings before calling the product ready.
