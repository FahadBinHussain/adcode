import { describe, expect, it } from "vitest";
import { looksLikePowerShell, shellFor } from "../src/main/aiCommands.ts";

describe("the shell an AI command runs in", () => {
  it("runs PowerShell the model wrote in PowerShell on Windows, instead of failing in cmd", () => {
    // The exact lines from 2026-10-27 reports.
    for (const line of ["Get-ChildItem -Recurse -Filter *.ts | Select-Object -First 5", "dir | ForEach-Object { $_.Name }", "$cat = (Invoke-WebRequest -UseBasicParsing https://example.com)", "echo $env:PATH", "Test-Path package.json"]) {
      expect(looksLikePowerShell(line), line).toBe(true);
      expect(shellFor(line, "win32").file).toMatch(/powershell\.exe$/);
      expect(shellFor(line, "win32").args.slice(-2)).toEqual(["-Command", line]);
    }
  });
  it("keeps ordinary commands in cmd, exactly as before", () => {
    for (const line of ["npm test", "git status", "npx tsc --noEmit", "gradlew.bat build", "python -m http.server 8000", "node scripts/build-sub-project.mjs", "echo set-up done"]) {
      expect(looksLikePowerShell(line), line).toBe(false);
      expect(shellFor(line, "win32")).toMatchObject({ args: ["/d", "/s", "/c", `"${line}"`], verbatim: true });
    }
  });
  it("leaves other platforms on /bin/sh", () => {
    expect(shellFor("Get-ChildItem", "linux")).toEqual({ file: "/bin/sh", args: ["-c", "Get-ChildItem"], verbatim: false });
  });
});
