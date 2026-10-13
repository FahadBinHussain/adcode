#!/usr/bin/env node
/**
 * Render the ADCode 2.3 launch film: 1920 × 1080, 44 seconds.
 *
 *   node marketing/launch-2-3/render.mjs                         # the whole deliverable, into out/
 *   node marketing/launch-2-3/render.mjs --stills 1.2,9.5,36     # just those frames, as PNG
 *   node marketing/launch-2-3/render.mjs --from 4 --to 12 --no-audio --fps 30   # a slice
 *
 * Options: --fps 60, --version 2.3, --url adcode.bluethenics.com, --stills a,b,c,
 * --no-video, --no-audio, --from, --to.
 *
 * Fonts and ffmpeg come from the Payback ad's tools (`node marketing/ad-payback/fetch-tools.mjs`
 * once), and the frame engine and the mark are shared with it through the `/shared/` route.
 * The browser is Playwright's Chromium rather than the repo's Electron, so a render needs
 * only `playwright` (global or local) and no app install.
 *
 * Every frame is `AD.render(t)` followed by two animation frames in the page and a capture
 * through the DevTools protocol, so what is encoded is exactly what that `t` draws.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { extname, join, normalize, sep } from "node:path";

const here = import.meta.dirname;
const STAGE = join(here, "stage");
const SHARED = join(here, "..", "ad-payback", "stage");
const tools = join(here, "..", "ad-payback", ".tools");
const FONTS = join(tools, "fonts");
const ffmpeg = join(tools, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const out = join(here, "out");
const WIDTH = 1920;
const HEIGHT = 1080;
const DURATION = 44;

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}

const stillsFlag = flag("stills", null);
const sliced = flag("from", null) !== null || flag("to", null) !== null;
const full = stillsFlag === null && !sliced && !process.argv.includes("--no-video") && !process.argv.includes("--no-audio");
const options = {
  fps: Number(flag("fps", 60)),
  from: Number(flag("from", 0)),
  to: Number(flag("to", DURATION)),
  version: String(flag("version", "2.3")),
  url: String(flag("url", "adcode.bluethenics.com")),
  stills: stillsFlag === null ? (full ? [41.5, 10.6, 24.4] : []) : String(stillsFlag).split(",").map(Number),
  stillNames: full ? ["poster.png", "still-agents.png", "still-free-ai.png"] : undefined,
  video: stillsFlag === null && !process.argv.includes("--no-video"),
  audio: stillsFlag === null && !process.argv.includes("--no-audio"),
};

if (!existsSync(ffmpeg) || !existsSync(join(FONTS, "fonts.css"))) {
  console.error("Missing tools. Run: node marketing/ad-payback/fetch-tools.mjs");
  process.exit(1);
}

/** Playwright from this repo if it has it, else the global install. */
function loadPlaywright() {
  for (const base of [join(here, "..", "..", "package.json"), join(execSync("npm root -g").toString().trim(), "_")]) {
    try { return createRequire(base)("playwright"); } catch { /* next */ }
  }
  console.error("Playwright is not installed. Run: npm install -g playwright");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Static files for the stage, confined to its three folders. */
function serve() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://stage").pathname;
    const [root, relative] = path.startsWith("/fonts/")
      ? [FONTS, path.slice("/fonts/".length)]
      : path.startsWith("/shared/")
        ? [SHARED, path.slice("/shared/".length)]
        : [STAGE, path === "/" ? "index.html" : path.slice(1)];
    const file = normalize(join(root, decodeURIComponent(relative)));
    if (!file.startsWith(root + sep)) return response.writeHead(403).end();
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function ff(args) {
  const run = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
}

const exited = (child) => new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
});

const started = Date.now();
const { chromium } = loadPlaywright();
const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
page.on("console", (message) => { if (message.type() === "error") console.error(`[stage] ${message.text()}`); });
page.on("pageerror", (error) => console.error(`[stage] ${error.message}`));
const cdp = await page.context().newCDPSession(page);
const query = new URLSearchParams({ version: options.version, url: options.url }).toString();
await page.goto(`${origin}/index.html?${query}`);
await page.evaluate("AD.ready()");
await mkdir(out, { recursive: true });

async function capture() {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    optimizeForSpeed: true,
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
  });
  return Buffer.from(data, "base64");
}

for (const [index, t] of options.stills.entries()) {
  await page.evaluate(`AD.render(${Number(t)})`);
  const name = options.stillNames?.[index] ?? `still-${String(t).replace(".", "_")}.png`;
  await writeFile(join(out, name), await capture());
  console.log(`still ${t}s → ${name}`);
}

const picture = join(out, "picture.mp4");
if (options.video) {
  const first = Math.round(options.from * options.fps);
  const last = Math.round(options.to * options.fps);
  const encoder = spawn(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-c:v", "png", "-framerate", String(options.fps), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "animation",
    "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", picture,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = exited(encoder);
  const begun = Date.now();
  for (let frame = first; frame < last; frame += 1) {
    await page.evaluate(`AD.render(${(frame / options.fps).toFixed(6)})`);
    const png = await capture();
    if (!encoder.stdin.write(png)) await new Promise((resolve) => encoder.stdin.once("drain", resolve));
    if ((frame - first) % options.fps === 0) {
      const rate = (frame - first + 1) / ((Date.now() - begun) / 1000);
      console.log(`frame ${frame}/${last} (${rate.toFixed(1)} fps)`);
    }
  }
  encoder.stdin.end();
  await done;
  console.log(`picture: ${last - first} frames`);
}

const soundtrack = join(out, "soundtrack.wav");
if (options.audio) {
  const base64 = await page.evaluate("AD.soundtrack()");
  await writeFile(soundtrack, Buffer.from(base64, "base64"));
  console.log("soundtrack.wav written");
}
await browser.close();
server.close();

const master = join(out, `ADCode-${options.version}-launch-1920x1080-${options.fps}fps.mp4`);
if (options.video && options.audio) {
  // Social players normalise to about -14 LUFS; arriving there means nothing gets squashed.
  ff(["-i", picture, "-ss", String(options.from), "-i", soundtrack, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-t", String(options.to - options.from), "-movflags", "+faststart", master]);
  // Two frames per second, 10 × 8: the whole film on one page, read back from the encoded file.
  ff(["-i", master, "-vf", "fps=2,scale=320:180,tile=10x8", "-frames:v", "1", join(out, "contact-sheet.png")]);
  if (full) await rm(picture, { force: true });
} else if (options.video) {
  ff(["-i", picture, "-c", "copy", "-movflags", "+faststart", master]);
  await rm(picture, { force: true });
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s → ${out}`);
