/** Verify the editor bundles the audited sanitizer, including Monaco's vendored import. */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageDirectory = dirname(dirname(require.resolve("dompurify")));
const { version } = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
const assets = join(import.meta.dirname, "../apps/desktop/out/renderer/assets");
const monacoChunks = (await readdir(assets)).filter(name => /^monaco-.*\.js$/.test(name));
if (monacoChunks.length === 0) throw new Error("The built editor chunk is missing.");
const versions = new Set();
for (const name of monacoChunks) {
  const contents = await readFile(join(assets, name), "utf8");
  for (const match of contents.matchAll(/\.version\s*=\s*["'](3\.\d+\.\d+)["']/g)) versions.add(match[1]);
}
if (!versions.has(version) || versions.size !== 1) {
  throw new Error(`The editor must bundle DOMPurify ${version}; found ${[...versions].join(", ") || "no sanitizer version"}. Check Monaco's vendored import.`);
}
console.log(`Editor sanitizer verified: DOMPurify ${version}.`);
