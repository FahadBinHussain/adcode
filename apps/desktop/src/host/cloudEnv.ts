/**
 * Where things live in a web sandbox, set before any main-process module reads it.
 *
 * Imported first by `host/index.ts`. Every path the main process uses comes from these
 * variables (through `app.getPath` in the electron stand-in, and `ADCODE_PROJECTS_HOME` in
 * `newProject.ts`), so the whole home folder - settings, conversations, projects - is one
 * directory the cloud can archive and restore.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const home = process.env["ADCODE_HOME"] ?? homedir();
process.env["ADCODE_HOME"] = home;
process.env["ADCODE_PROJECTS_HOME"] ??= join(home, "projects");
process.env["ADCODE_USER_DATA_DIR"] ??= join(home, ".adcode");
process.env["ADCODE_PLATFORM"] ??= "web";

/*
 * `ws` speeds up unmasking with the optional native `bufferutil`. Bundled, Vite replaces that
 * optional dependency with an empty object, and every masked frame a browser sends over 32
 * bytes then throws inside the receiver - the server could talk but never hear. These are
 * `ws`'s own switches for running on its pure-JavaScript paths.
 */
process.env["WS_NO_BUFFER_UTIL"] = "1";
process.env["WS_NO_UTF_8_VALIDATE"] = "1";

// Electron sets this to the folder beside the app; plain Node does not, and `join(undefined)` throws.
const withResources = process as NodeJS.Process & { resourcesPath?: string };
if (typeof withResources.resourcesPath !== "string") {
  withResources.resourcesPath = process.env["ADCODE_RESOURCES"] ?? join(dirname(fileURLToPath(import.meta.url)), "resources");
}

mkdirSync(process.env["ADCODE_PROJECTS_HOME"], { recursive: true });
mkdirSync(process.env["ADCODE_USER_DATA_DIR"], { recursive: true });
