/**
 * Builds adcode-host: the main process as one Node program, for the web version's sandbox.
 *
 * The same sources as the desktop's main process, with one difference - the module specifier
 * `electron` resolves to `src/host/electronShim.ts`. The local-package aliases are imported
 * from `electron.vite.config.ts` rather than copied, so CLAUDE.md's three alias lists do not
 * become four.
 *
 *   npx vite build -c apps/desktop/vite.host.config.ts   ->   apps/desktop/out/host/index.js
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { alias } from "./electron.vite.config.ts";

const version = (JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")) as { version: string }).version;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^electron$/, replacement: resolve(import.meta.dirname, "src/host/electronShim.ts") },
      ...Object.entries(alias).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  define: {
    // The desktop's Google sign-in secret has no use here: on the web, sign-in happens in the browser.
    __ADCODE_GOOGLE_CLIENT_SECRET__: JSON.stringify(""),
    __ADCODE_VERSION__: JSON.stringify(version),
  },
  ssr: {
    noExternal: true,
    // node-pty finds its native binary by building a path at runtime, so it is installed, not bundled.
    external: ["node-pty"],
  },
  build: {
    ssr: resolve(import.meta.dirname, "src/host/index.ts"),
    outDir: resolve(import.meta.dirname, "out/host"),
    emptyOutDir: true,
    target: "node24",
    minify: false,
    sourcemap: true,
    rollupOptions: {
      output: { format: "es", entryFileNames: "index.js" },
    },
  },
});
