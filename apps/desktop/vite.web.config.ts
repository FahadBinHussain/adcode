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
          .replace("<title>ADCode</title>", '<title>ADCode</title>\n    <meta name="robots" content="noindex" />\n    <meta name="theme-color" content="#1c1c1e" />\n    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />')
          .replace("<body>", '<body data-surface="web">\n    <div id="web-gate"></div>');
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
