/**
 * The platform a request says it came from: the operating system on the desktop, `web` in the
 * web version's sandbox (which runs Linux, but whose people are on the web).
 */
export function reportedPlatform(env: Readonly<Record<string, string | undefined>>, platform: string): string {
  return env["ADCODE_PLATFORM"] === "web" ? "web" : platform;
}
