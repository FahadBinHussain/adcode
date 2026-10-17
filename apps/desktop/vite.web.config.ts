/**
 * Builds the web version's page: the desktop renderer, booted by `src/web/boot.ts`.
 *
 * Same sources and the same `index.html` as the Electron renderer. A small plugin swaps the
 * page's module script for the web entry, which signs in, connects to the sandbox, installs a
 * socket-backed `window.adcode`, and only then loads the renderer. The local-package aliases
 * are imported from `electron.vite.config.ts`, not copied.
 *
 *   npx vite build -c apps/desktop/vite.web.config.ts     -> apps/cloud/public
 *   npx vite -c apps/desktop/vite.web.config.ts           -> dev server, /socket proxied to adcode-host
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { alias } from "./electron.vite.config.ts";
import { webAppHead, WEB_APP_SPLASH } from "./src/web/seo.ts";

const DESKTOP = import.meta.dirname;
const REPO = resolve(DESKTOP, "../..");
// Resolved the way Node would, so the build also works from a worktree sharing the main checkout's node_modules.
const DOMPURIFY = resolve(dirname(createRequire(import.meta.url).resolve("dompurify")), "purify.es.mjs");

interface FirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
}

/** Public by design - these identify the Firebase project, they authorise nothing. */
function firebaseConfig(): FirebaseWebConfig {
  const fromFile: Record<string, string> = {};
  for (const file of [resolve(REPO, "apps/web/.env.production"), resolve(REPO, "apps/web/.env.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*NEXT_PUBLIC_FIREBASE_([A-Z_]+)\s*=\s*"?([^"\s]*)"?\s*$/.exec(line);
      if (match !== null && match[2]!.length > 0 && fromFile[match[1]!] === undefined) fromFile[match[1]!] = match[2]!;
    }
  }
  const pick = (name: string): string => process.env[`ADCODE_FIREBASE_${name}`] ?? fromFile[name] ?? "";
  return { apiKey: pick("API_KEY"), authDomain: pick("AUTH_DOMAIN"), projectId: pick("PROJECT_ID"), appId: pick("APP_ID") };
}

/*
 * The first paint, before any script or stylesheet has arrived.
 *
 * The page is the desktop renderer's `index.html`, which carries the whole workbench as plain
 * markup - explorer, status bar, Share. On a slow connection that markup showed unstyled for
 * seconds ("Explorer No folder opened Open ... Ln 1, Col 1 Share") while the module script
 * loaded. These few rules, inline in the head, keep everything but the gate invisible until
 * the shell says it is ready (`body[data-shell="ready"]`), and paint a branded splash in the
 * gate from the HTML alone. `visibility`, not `display`: the renderer measures its layout
 * while it boots, and a hidden-but-laid-out workbench measures right.
 */
const CRITICAL_CSS = [
  "html,body{margin:0;height:100%;background:#111110;color:#ebe8e1}",
  "body[data-surface=web]:not([data-shell=ready])>:not(#web-gate){visibility:hidden!important}",
  "#web-gate.web-gate-splash{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:radial-gradient(ellipse 60% 50% at 50% 42%,#1c1b19 0%,#111110 70%)}",
  ".web-splash{display:grid;justify-items:center;gap:18px;font:600 15px/1.2 system-ui,sans-serif;letter-spacing:.01em;color:#ebe8e1}",
  ".web-splash{box-sizing:border-box;max-width:560px;padding:24px;text-align:center}.web-splash h1{margin:0;font-size:24px;line-height:1.25}.web-splash p{margin:0;font-weight:400;line-height:1.6;color:#b9b7b2}.web-splash nav{display:flex;flex-wrap:wrap;justify-content:center;gap:18px}.web-splash a{color:#b2d8bd;text-underline-offset:4px}",
  ".web-splash img{width:56px;height:56px;border-radius:14px;box-shadow:0 0 0 1px #2d2b28,0 18px 48px rgb(0 0 0/.55);animation:web-splash-breathe 2.4s ease-in-out infinite}",
  ".web-splash-bar{width:132px;height:2px;border-radius:2px;overflow:hidden;background:#2d2b28}",
  ".web-splash-bar::after{content:'';display:block;width:40%;height:100%;border-radius:inherit;background:linear-gradient(90deg,transparent,#6fb98f,transparent);animation:web-splash-scan 1.1s cubic-bezier(.65,0,.35,1) infinite}",
  "@keyframes web-splash-scan{from{transform:translateX(-100%)}to{transform:translateX(250%)}}",
  "@keyframes web-splash-breathe{50%{transform:scale(.96);opacity:.85}}",
  "@media (prefers-reduced-motion:reduce){.web-splash img,.web-splash-bar::after{animation:none}}",
].join("");

const SPLASH = WEB_APP_SPLASH;

/** The app's three faces, fetched with the page so text never reflows into them later. */
const FONT_PRELOADS = ["manrope", "space-grotesk", "geist-mono"]
  .map((name) => `    <link rel="preload" href="/fonts/${name}.woff2" as="font" type="font/woff2" crossorigin />`)
  .join("\n");

/** Swap the Electron renderer's entry for the web one; everything else in the page stays. */
function webEntry(): Plugin {
  return {
    name: "adcode-web-entry",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const swapped = html.replace('<script type="module" src="./main.ts"></script>', '<script type="module" src="/@web/boot.ts"></script>');
        if (swapped === html) throw new Error("adcode-web-entry: the renderer's module script moved; update vite.web.config.ts");
        return swapped
          .replace("<title>ADCode</title>", `${webAppHead()}\n    <meta name="theme-color" content="#111110" />\n    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />\n${FONT_PRELOADS}\n    <style id="web-critical">${CRITICAL_CSS}</style>`)
          .replace("<body>", `<body data-surface="web">\n    <div id="web-gate" class="web-gate web-gate-splash">${SPLASH}</div>`);
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: resolve(DESKTOP, "src/renderer"),
  publicDir: resolve(DESKTOP, "src/renderer/public"),
  // Its own cache, so this dev server never fights the desktop's electron-vite over one folder.
  cacheDir: resolve(DESKTOP, "out/.vite-web"),
  plugins: [webEntry()],
  optimizeDeps: {
    // The scanner reads the page's raw HTML, which still names the desktop's `./main.ts`; the web
    // entry's own imports (Firebase) would otherwise be found mid-load, and Vite's re-optimise
    // breaks the first visit's dynamic import of the renderer.
    entries: ["index.html", "main.ts", "../web/boot.ts"],
    include: ["firebase/app", "firebase/auth"],
  },
  resolve: {
    alias: [
      { find: /^\/@web\//, replacement: `${resolve(DESKTOP, "src/web")}/` },
      // Monaco vendors its own DOMPurify copy; resolve it to the audited lockfile version, as the desktop does.
      { find: "./dompurify/dompurify.js", replacement: DOMPURIFY },
      ...Object.entries(alias).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  define: {
    __ADCODE_WEB_DEV__: JSON.stringify(mode === "development"),
    __ADCODE_FIREBASE__: JSON.stringify(firebaseConfig()),
  },
  server: {
    port: 5180,
    strictPort: true,
    fs: { allow: [REPO] },
    proxy: {
      "/socket": { target: `ws://127.0.0.1:${process.env["ADCODE_HOST_PORT"] ?? "7300"}`, ws: true },
      "/__adcode": { target: `http://127.0.0.1:${process.env["ADCODE_HOST_PORT"] ?? "7300"}` },
    },
  },
  build: {
    outDir: resolve(REPO, "apps/cloud/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: { manualChunks: { monaco: ["monaco-editor"] } },
    },
  },
  worker: { format: "es" as const },
}));
