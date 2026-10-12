import { mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** Electron's Chromium switch alone does not isolate app.getPath("userData"). */
export function initializeLaunchProfile(
  app: { setPath(name: "userData" | "sessionData", path: string): void },
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = {},
): string | null {
  const index = args.findIndex(arg => arg === "--user-data-dir" || arg.startsWith("--user-data-dir="));
  const argument = args[index];
  const directory = index === -1
    ? environment["ADCODE_USER_DATA_DIR"]
    : argument === "--user-data-dir" ? args[index + 1] : argument!.slice("--user-data-dir=".length);
  if (index === -1 && directory === undefined) return null;
  if (!directory || !isAbsolute(directory)) throw new Error("--user-data-dir requires an absolute profile directory");
  const profile = resolve(directory);
  mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
  return profile;
}
