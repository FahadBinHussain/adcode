/** Public launch copy is shipped in HTML, before sign-in or any private workspace loads. */
const SITE = "https://adcode.bluethenics.com";
const APP = "https://web.bluethenics.com/";
const TITLE = "ADCode Web — AI Code Editor in Your Browser";
const DESCRIPTION = "Build apps in your browser with AI agents that write code, run commands, and show live previews. Sign in to ADCode Web for your private Linux workspace.";
export const WEB_APP_HEADING = "Build apps with AI in your browser";
export const WEB_APP_INTRO = "Describe an app and let AI agents write code, run commands, and show live previews in a private Linux workspace. Sign in to open your workspace.";
export const WEB_APP_GUIDE_URL = `${SITE}/online-ai-code-editor`;
export const WEB_APP_SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": `${APP}#app`,
  name: "ADCode Web",
  url: APP,
  description: DESCRIPTION,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web browser",
  browserRequirements: "Requires JavaScript and sign-in.",
  publisher: { "@id": `${SITE}/#organization` },
});

/**
 * Builds remain noindex until the production Worker explicitly opens the public root.
 * The marker lets an older or incomplete build stay closed rather than index an empty shell.
 */
export function webAppHead(): string {
  return [
    `<title>${TITLE}</title>`,
    '<meta name="robots" content="noindex, nofollow" data-adcode-public-launch />',
    `<meta name="description" content="${DESCRIPTION}" />`,
    `<link rel="canonical" href="${APP}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="ADCode" />',
    `<meta property="og:title" content="${TITLE}" />`,
    `<meta property="og:description" content="${DESCRIPTION}" />`,
    `<meta property="og:url" content="${APP}" />`,
    `<meta property="og:image" content="${SITE}/opengraph-image.png" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${TITLE}" />`,
    `<meta name="twitter:description" content="${DESCRIPTION}" />`,
    `<meta name="twitter:image" content="${SITE}/opengraph-image.png" />`,
    `<script type="application/ld+json" id="adcode-web-app-schema">${WEB_APP_SCHEMA}</script>`,
  ].join("\n    ");
}

/** The same useful introduction is visible to people and crawlers while sign-in loads. */
export const WEB_APP_SPLASH = `<div class="web-splash">
      <img src="/favicon.svg" alt="" width="56" height="56" />
      <h1>${WEB_APP_HEADING}</h1>
      <p>${WEB_APP_INTRO}</p>
      <nav aria-label="About ADCode Web"><a href="${WEB_APP_GUIDE_URL}">How it works</a><a href="${SITE}/docs">Documentation</a><a href="${SITE}/privacy">Privacy</a></nav>
      <span role="status">Loading workspace sign-in…</span><span class="web-splash-bar" aria-hidden="true"></span>
      <noscript><p>JavaScript is required to sign in and use the editor. The guide and documentation above work without signing in.</p></noscript>
    </div>`;
